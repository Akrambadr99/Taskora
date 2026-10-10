import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'

import { DataTable, type DataTableColumn } from '../../components/data-table/DataTable'
import type { IssueSortField } from '../../data'
import type { Issue, IssueId, IssuePriority, Project, WorkflowStatusId } from '../../domain'
import {
  useBulkUpdateIssues,
  useIssueWorkspaceData,
  type BulkIssueUpdateResult,
} from '../../features/issues/issue-queries'
import {
  parseIssueWorkspaceState,
  reconcileIssueWorkspaceState,
  serializeIssueWorkspaceState,
  type IssueWorkspaceState,
} from '../../features/issues/issue-workspace-state'
import { IssueCreateDialog } from '../../features/issues/IssueCreateDialog'
import { SavedIssueViews } from '../../features/issues/SavedIssueViews'
import {
  defaultIssueTableLayout,
  issueTableColumnIds,
  useUserPreferences,
  type IssueTableColumnId,
  type IssueTableLayout,
} from '../../preferences'
import { useAppServices } from '../providers/app-services-context'
import { useAuthorization } from '../providers/authorization-context'
import './issues-page.css'
import './pages.css'

const priorityOptions: readonly IssuePriority[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
]

export function IssuesPage() {
  const authorization = useAuthorization()
  const location = useLocation()
  const [parameters, setParameters] = useSearchParams()
  const state = useMemo(() => parseIssueWorkspaceState(parameters), [parameters])
  const pendingState = useRef(state)
  const preferences = useUserPreferences()
  const { issues, filterMetadata } = useIssueWorkspaceData(
    state,
    preferences.issuePageSize,
  )
  const bulkUpdate = useBulkUpdateIssues()
  const [selectedIssues, setSelectedIssues] = useState<ReadonlyMap<IssueId, Issue>>(
    () => new Map(),
  )
  const [bulkPriority, setBulkPriority] = useState<IssuePriority>('medium')
  const [bulkWorkflowStatusId, setBulkWorkflowStatusId] = useState<WorkflowStatusId | null>(null)
  const [bulkStatus, setBulkStatus] = useState('')
  const filterStatus = readFilterStatus(location.state)
  const focusFilterStatus = shouldFocusFilterStatus(location.state)
  const filterStatusRef = useRef<HTMLParagraphElement>(null)
  const creatingIssue = parameters.get('create') === '1'
  const canCreateIssue =
    authorization.can('issue:create') ||
    authorization.session.projectMemberships.some(({ projectId }) =>
      authorization.can('issue:create', projectId),
    )

  const filterProjects = useMemo(
    () => filterMetadata.data?.projects ?? [],
    [filterMetadata.data],
  )
  const projects = useMemo(
    () => filterProjects.map(({ project }) => project),
    [filterProjects],
  )
  const projectFilters = useMemo(
    () => filterProjects.map(({ project, statuses }) => ({
      id: project.id,
      statusIds: statuses.map(({ id }) => id),
    })),
    [filterProjects],
  )
  const statusProjects = state.projectId
    ? filterProjects.filter(({ project }) => project.id === state.projectId)
    : filterProjects
  const selectedProjectIds = new Set([...selectedIssues.values()].map(({ projectId }) => projectId))
  const selectedProjectId = selectedProjectIds.size === 1 ? [...selectedProjectIds][0] : null
  const bulkWorkflow = filterProjects.find(({ project }) => project.id === selectedProjectId)?.statuses ?? []
  const bulkWorkflowStatus = bulkWorkflow.find(({ id }) => id === bulkWorkflowStatusId) ?? bulkWorkflow[0]

  useEffect(() => {
    pendingState.current = state
  }, [state])

  useEffect(() => {
    if (!creatingIssue || canCreateIssue) return
    setParameters((current) => {
      const next = new URLSearchParams(current)
      next.delete('create')
      return next
    }, {
      replace: true,
      state: {
        filterStatus: 'Your issue creation permission changed. No issue was created.',
        focusFilterStatus: true,
      },
    })
  }, [canCreateIssue, creatingIssue, setParameters])

  useEffect(() => {
    if (!filterStatus || !focusFilterStatus) return
    filterStatusRef.current?.focus()
  }, [filterStatus, focusFilterStatus])

  useEffect(() => {
    if (!filterMetadata.data) return
    const reconciled = reconcileIssueWorkspaceState(state, projectFilters)
    if (reconciled === state) return
    setParameters(serializeIssueWorkspaceState(reconciled), {
      replace: true,
      state: {
        filterStatus: 'Unavailable project or workflow filters were removed.',
      },
    })
  }, [filterMetadata.data, projectFilters, setParameters, state])

  const updateState = (changes: Partial<IssueWorkspaceState>) => {
    const nextState = {
      ...pendingState.current,
      ...changes,
      page: changes.page ?? 1,
    }
    pendingState.current = nextState
    setParameters(serializeIssueWorkspaceState(nextState), { state: null })
  }

  const handleSearch = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('search')
    updateState({
      search: typeof value === 'string' ? value.trim().slice(0, 200) : '',
    })
  }

  const handleSort = (field: string) => {
    const sortField = field as IssueSortField
    updateState({
      sortField,
      sortDirection:
        state.sortField === sortField && state.sortDirection === 'ascending'
          ? 'descending'
          : 'ascending',
    })
  }

  const toggleIssue = (issue: Issue, selected: boolean) => {
    setSelectedIssues((current) => {
      const next = new Map(current)
      if (selected) next.set(issue.id, issue)
      else next.delete(issue.id)
      return next
    })
    setBulkStatus('')
  }

  const togglePage = (pageIssues: readonly Issue[], selected: boolean) => {
    setSelectedIssues((current) => {
      const next = new Map(current)
      for (const issue of pageIssues) {
        if (selected) next.set(issue.id, issue)
        else next.delete(issue.id)
      }
      return next
    })
    setBulkStatus('')
  }

  const handleBulkResult = (result: BulkIssueUpdateResult) => {
    setSelectedIssues(
      new Map(result.failed.map(({ issue }) => [issue.id, issue] as const)),
    )
    setBulkStatus(formatBulkResult(result))
  }

  const isInitialLoading = issues.isPending || filterMetadata.isPending

  return (
    <section className="page" aria-labelledby="issues-title">
      <header className="page-header issues-header">
        <div>
          <p className="page-eyebrow">Workspace execution</p>
          <h1 id="issues-title">Issues</h1>
          <p>Find, prioritize, and review work across every active project.</p>
        </div>
        <div className="issues-header__actions">
          {issues.data ? (
            <p className="issues-header__count" aria-live="polite">
              {issues.data.totalItems} matching{' '}
              {issues.data.totalItems === 1 ? 'issue' : 'issues'}
            </p>
          ) : null}
          {canCreateIssue ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                const next = new URLSearchParams(parameters)
                next.set('create', '1')
                setParameters(next)
              }}
            >
              Create issue
            </button>
          ) : null}
        </div>
      </header>

      {creatingIssue ? (
        <IssueCreateDialog
          onClose={() => {
            const next = new URLSearchParams(parameters)
            next.delete('create')
            setParameters(next, { replace: true })
          }}
        />
      ) : null}

      <SavedIssueViews
        currentState={state}
        canApply={filterMetadata.isSuccess && !filterMetadata.isFetching}
        onApply={(savedState) => {
          const reconciled = reconcileIssueWorkspaceState(
            savedState,
            projectFilters,
          )
          setSelectedIssues(new Map())
          setBulkStatus('')
          setParameters(serializeIssueWorkspaceState(reconciled), { state: null })
          return {
            state: reconciled,
            adjusted: reconciled !== savedState,
          }
        }}
        onPageSizeChange={() => {
          updateState({ page: 1 })
        }}
      />

      {filterStatus ? (
        <p
          ref={filterStatusRef}
          className="bulk-status"
          role="status"
          tabIndex={focusFilterStatus ? -1 : undefined}
        >
          {filterStatus}
        </p>
      ) : null}

      <IssueTableLayoutControls />

      <form className="issue-filters" role="search" onSubmit={handleSearch}>
        <label className="issue-filter issue-filter--search">
          <span>Search issues</span>
          <input
            key={state.search}
            name="search"
            type="search"
            defaultValue={state.search}
            maxLength={200}
            placeholder="Title, description, or number"
          />
        </label>
        <label className="issue-filter">
          <span>Project</span>
          <select
            value={state.projectId ?? ''}
            onChange={(event) => {
              updateState({
                projectId:
                  projects.find(({ id }) => id === event.currentTarget.value)
                    ?.id ?? null,
                statusId:
                  state.statusId &&
                  filterProjects
                    .find(({ project }) => project.id === event.currentTarget.value)
                    ?.statuses.some(({ id }) => id === state.statusId)
                    ? state.statusId
                    : null,
              })
            }}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="issue-filter">
          <span>Workflow status</span>
          <select
            value={state.statusId ?? ''}
            onChange={(event) => {
              const statusId = statusProjects
                .flatMap(({ statuses }) => statuses)
                .find(({ id }) => id === event.currentTarget.value)?.id ?? null
              updateState({ statusId })
            }}
          >
            <option value="">All statuses</option>
            {statusProjects.map(({ project, statuses }) => (
              <optgroup key={project.id} label={project.name}>
                {statuses.map((status) => (
                  <option key={status.id} value={status.id}>{status.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="issue-filter">
          <span>Priority</span>
          <select
            value={state.priority ?? ''}
            onChange={(event) => {
              updateState({
                priority:
                  priorityOptions.find(
                    (priority) => priority === event.currentTarget.value,
                  ) ?? null,
              })
            }}
          >
            <option value="">All priorities</option>
            {priorityOptions.map((priority) => (
              <option key={priority} value={priority}>
                {capitalize(priority)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" type="submit">
          Search
        </button>
      </form>

      {selectedIssues.size > 0 ? (
        <section className="bulk-actions" aria-label="Bulk issue actions">
          <p aria-live="polite">
            <strong>{selectedIssues.size}</strong>{' '}
            {selectedIssues.size === 1 ? 'issue' : 'issues'} selected
          </p>
          <label className="issue-filter">
            <span>Set priority</span>
            <select
              value={bulkPriority}
              disabled={bulkUpdate.isPending}
              onChange={(event) => {
                const priority = priorityOptions.find(
                  (candidate) => candidate === event.currentTarget.value,
                )
                if (priority) setBulkPriority(priority)
              }}
            >
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {capitalize(priority)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={bulkUpdate.isPending}
            onClick={() => {
              bulkUpdate.mutate(
                { issues: [...selectedIssues.values()], changes: { priority: bulkPriority } },
                { onSuccess: handleBulkResult },
              )
            }}
          >
            {bulkUpdate.isPending ? 'Updating…' : 'Apply priority'}
          </button>
          {bulkWorkflowStatus ? (
            <>
              <label className="issue-filter">
                <span>Set status</span>
                <select
                  value={bulkWorkflowStatus.id}
                  disabled={bulkUpdate.isPending}
                  onChange={(event) => {
                    const status = bulkWorkflow.find(({ id }) => id === event.currentTarget.value)
                    if (status) setBulkWorkflowStatusId(status.id)
                  }}
                >
                  {bulkWorkflow.map((status) => (
                    <option key={status.id} value={status.id}>{status.name}</option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={bulkUpdate.isPending}
                onClick={() => {
                  bulkUpdate.mutate(
                    { issues: [...selectedIssues.values()], changes: { statusId: bulkWorkflowStatus.id } },
                    { onSuccess: handleBulkResult },
                  )
                }}
              >
                {bulkUpdate.isPending ? 'Updating…' : 'Apply status'}
              </button>
            </>
          ) : (
            <p>Select issues from one project to change their workflow status together.</p>
          )}
          <button
            className="secondary-button"
            type="button"
            disabled={bulkUpdate.isPending}
            onClick={() => {
              setSelectedIssues(new Map())
              setBulkStatus('Selection cleared.')
            }}
          >
            Clear selection
          </button>
        </section>
      ) : null}

      {bulkStatus ? (
        <p className="bulk-status" role="status">{bulkStatus}</p>
      ) : null}

      {isInitialLoading ? (
        <div className="dashboard-state" role="status" aria-live="polite">
          Loading issues…
        </div>
      ) : issues.isError || filterMetadata.isError ? (
        <div className="dashboard-state dashboard-state--error" role="alert">
          <h2>Issues are unavailable</h2>
          <p>The local service could not load this workspace.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void Promise.all([issues.refetch(), filterMetadata.refetch()])}
          >
            Retry issues
          </button>
        </div>
      ) : (
        <IssueResults
          issues={issues.data.items}
          projects={projects}
          pageNumber={issues.data.pageNumber}
          pageCount={issues.data.pageCount}
          totalItems={issues.data.totalItems}
          state={state}
          isRefreshing={issues.isFetching}
          selectedIssues={selectedIssues}
          onPageChange={(page) => {
            updateState({ page })
          }}
          onSort={handleSort}
          onToggleIssue={toggleIssue}
          onTogglePage={togglePage}
          isIssueSelectable={(issue) =>
            authorization.can('issue:update', issue.projectId) &&
            projects.some(
              (project) =>
                project.id === issue.projectId &&
                (project.status === 'planned' ||
                  project.status === 'active' ||
                  project.status === 'paused'),
            )
          }
          tableLayout={preferences.issueTableLayout}
        />
      )}
    </section>
  )
}

interface IssueResultsProps {
  readonly issues: readonly Issue[]
  readonly projects: readonly Project[]
  readonly pageNumber: number
  readonly pageCount: number
  readonly totalItems: number
  readonly state: IssueWorkspaceState
  readonly isRefreshing: boolean
  readonly selectedIssues: ReadonlyMap<IssueId, Issue>
  readonly onPageChange: (page: number) => void
  readonly onSort: (field: string) => void
  readonly onToggleIssue: (issue: Issue, selected: boolean) => void
  readonly onTogglePage: (issues: readonly Issue[], selected: boolean) => void
  readonly isIssueSelectable: (issue: Issue) => boolean
  readonly tableLayout: IssueTableLayout
}

function IssueResults({
  issues,
  projects,
  pageNumber,
  pageCount,
  totalItems,
  state,
  isRefreshing,
  selectedIssues,
  onPageChange,
  onSort,
  onToggleIssue,
  onTogglePage,
  isIssueSelectable,
  tableLayout,
}: IssueResultsProps) {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const columns: readonly DataTableColumn<Issue>[] = [
    {
      id: 'number',
      label: 'Issue',
      sortField: 'number',
      render: (issue) => (
        <span className="issue-identifier">
          {projectById.get(issue.projectId)?.key ?? '—'}-{issue.number}
        </span>
      ),
    },
    {
      id: 'title',
      label: 'Title',
      sortField: 'title',
      render: (issue) => (
        <Link className="table-link" to={`/issues/${issue.id}`}>
          {issue.title}
        </Link>
      ),
    },
    {
      id: 'project',
      label: 'Project',
      render: (issue) => projectById.get(issue.projectId)?.name ?? 'Unknown project',
    },
    {
      id: 'priority',
      label: 'Priority',
      sortField: 'priority',
      render: (issue) => (
        <span className={`priority-badge priority-badge--${issue.priority}`}>
          {capitalize(issue.priority)}
        </span>
      ),
    },
    {
      id: 'type',
      label: 'Type',
      render: (issue) => capitalize(issue.type),
    },
    {
      id: 'dueDate',
      label: 'Due',
      sortField: 'dueDate',
      render: (issue) => issue.dueDate ?? 'No due date',
    },
  ]
  const columnsById = new Map(columns.map((column) => [column.id, column]))
  const visibleColumns = tableLayout.columns.flatMap((id) => {
    const column = columnsById.get(id)
    return column ? [column] : []
  })

  if (issues.length === 0 && totalItems > 0) {
    return (
      <div className="empty-panel">
        <p className="empty-panel__status">Page out of range</p>
        <p>The requested page no longer exists for this result set.</p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            onPageChange(1)
          }}
        >
          Return to first page
        </button>
      </div>
    )
  }

  if (totalItems === 0) {
    return (
      <div className="empty-panel">
        <p className="empty-panel__status">No matching issues</p>
        <p>Try removing a filter or using a broader search term.</p>
      </div>
    )
  }

  return (
    <div className="issue-results" aria-busy={isRefreshing}>
      {isRefreshing ? <p className="issue-results__refresh">Refreshing results…</p> : null}
      <DataTable
        caption="Workspace issues"
        columns={visibleColumns}
        density={tableLayout.density}
        getRowKey={(issue) => issue.id}
        rows={issues}
        sort={{ field: state.sortField, direction: state.sortDirection }}
        onSort={onSort}
        selection={{
          getLabel: (issue) => `Select ${issue.title}`,
          isRowSelectable: isIssueSelectable,
          isSelected: (issue) => selectedIssues.has(issue.id),
          onToggleRow: onToggleIssue,
          onToggleAllRows: onTogglePage,
        }}
      />
      <nav className="pagination" aria-label="Issues pagination">
        <button
          className="secondary-button"
          type="button"
          disabled={pageNumber <= 1}
          onClick={() => {
            onPageChange(pageNumber - 1)
          }}
        >
          Previous
        </button>
        <p aria-live="polite">
          Page {pageNumber} of {Math.max(pageCount, 1)}
        </p>
        <button
          className="secondary-button"
          type="button"
          disabled={pageNumber >= pageCount}
          onClick={() => {
            onPageChange(pageNumber + 1)
          }}
        >
          Next
        </button>
      </nav>
    </div>
  )
}

const issueTableColumnLabels: Readonly<Record<IssueTableColumnId, string>> = {
  number: 'Issue',
  title: 'Title',
  project: 'Project',
  priority: 'Priority',
  type: 'Type',
  dueDate: 'Due date',
}

function IssueTableLayoutControls() {
  const { preferences: repository } = useAppServices()
  const preferences = useUserPreferences()
  const panelId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const layout = preferences.issueTableLayout

  const save = (next: IssueTableLayout, successMessage: string): void => {
    try {
      repository.setIssueTableLayout(next)
      setMessage(successMessage)
      setIsError(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Table layout could not be saved.')
      setIsError(true)
    }
  }

  const move = (id: IssueTableColumnId, offset: -1 | 1): void => {
    const index = layout.columns.indexOf(id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= layout.columns.length) return
    const columns = [...layout.columns]
    const [column] = columns.splice(index, 1)
    if (!column) return
    columns.splice(target, 0, column)
    save({ ...layout, columns }, `${issueTableColumnLabels[id]} column moved.`)
  }

  return (
    <section className="issue-table-layout" aria-label="Issue table layout">
      <button
        className="issue-table-layout__trigger"
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => { setIsOpen((current) => !current) }}
      >
        Customize issue table
      </button>
      {isOpen ? (
        <div id={panelId} className="issue-table-layout__content">
          <label>
            <span>Row density</span>
            <select
              value={layout.density}
              onChange={(event) => {
                const density = event.currentTarget.value === 'compact'
                  ? 'compact'
                  : 'comfortable'
                save({ ...layout, density }, `Table density set to ${density}.`)
              }}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <ul aria-label="Issue table columns">
            {issueTableColumnIds.map((id) => {
              const visible = layout.columns.includes(id)
              const index = layout.columns.indexOf(id)
              const required = id === 'number' || id === 'title'
              return (
                <li key={id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={required}
                      onChange={(event) => {
                        const columns = event.currentTarget.checked
                          ? [...layout.columns, id]
                          : layout.columns.filter((column) => column !== id)
                        save(
                          { ...layout, columns },
                          `${issueTableColumnLabels[id]} column ${event.currentTarget.checked ? 'shown' : 'hidden'}.`,
                        )
                      }}
                    />
                    {issueTableColumnLabels[id]} column{required ? ' (required)' : ''}
                  </label>
                  {visible ? (
                    <span className="issue-table-layout__order">
                      <button
                        className="text-button"
                        type="button"
                        disabled={index <= 0}
                        onClick={() => { move(id, -1) }}
                      >
                        Move {issueTableColumnLabels[id]} earlier
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        disabled={index >= layout.columns.length - 1}
                        onClick={() => { move(id, 1) }}
                      >
                        Move {issueTableColumnLabels[id]} later
                      </button>
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              save(defaultIssueTableLayout, 'Default table layout restored.')
            }}
          >
            Restore default layout
          </button>
          {message ? (
            <p role={isError ? 'alert' : 'status'}>{message}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}

function readFilterStatus(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('filterStatus' in state)) {
    return ''
  }
  return typeof state.filterStatus === 'string' ? state.filterStatus : ''
}

function shouldFocusFilterStatus(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'focusFilterStatus' in state &&
    state.focusFilterStatus === true
  )
}

function formatBulkResult(result: BulkIssueUpdateResult): string {
  const updated = `${result.updated.length.toString()} ${result.updated.length === 1 ? 'issue' : 'issues'} updated.`
  if (result.failed.length === 0) return updated

  const failed = `${result.failed.length.toString()} ${result.failed.length === 1 ? 'issue failed and remains' : 'issues failed and remain'} selected.`
  return `${updated} ${failed} ${result.failed[0]?.message ?? ''}`.trim()
}
