import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  useBoardIssues,
  useBoardMetadata,
  useMoveBoardIssue,
} from '../../features/board/board-queries'
import type { Issue, WorkflowStatusId } from '../../domain'
import { hasAppErrorKind } from '../errors/classify-app-error'
import { useAuthorization } from '../providers/authorization-context'
import './board-page.css'
import './pages.css'

export function BoardPage() {
  const authorization = useAuthorization()
  const [searchParams, setSearchParams] = useSearchParams()
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [draggedIssueId, setDraggedIssueId] = useState<Issue['id'] | null>(null)
  const [dragTargetStatusId, setDragTargetStatusId] =
    useState<WorkflowStatusId | null>(null)
  const [dragFocusIssueId, setDragFocusIssueId] = useState<Issue['id'] | null>(null)
  const dragHandleRefs = useRef(new Map<Issue['id'], HTMLButtonElement>())
  const metadata = useBoardMetadata()
  const requestedProjectId = searchParams.get('project')
  const selectedProject =
    metadata.data?.projects.find(
      ({ project }) => project.id === requestedProjectId,
    ) ?? metadata.data?.projects[0]
  const projectId = selectedProject?.project.id ?? null
  const issues = useBoardIssues(projectId)
  const moveIssue = useMoveBoardIssue(projectId)
  const loadedIssues = useMemo(
    () => issues.data?.pages.flatMap((page) => page.items) ?? [],
    [issues.data],
  )
  const totalIssues = issues.data?.pages[0]?.totalItems ?? 0

  useEffect(() => {
    if (dragFocusIssueId === null || moveIssue.isPending) return
    const handle = dragHandleRefs.current.get(dragFocusIssueId)
    if (!handle) return
    handle.focus()
    setDragFocusIssueId(null)
  }, [dragFocusIssueId, loadedIssues, moveIssue.isPending])

  useEffect(() => {
    if (!selectedProject || requestedProjectId === selectedProject.project.id) {
      return
    }

    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('project', selectedProject.project.id)
        return next
      },
      { replace: true },
    )
  }, [requestedProjectId, selectedProject, setSearchParams])

  if (metadata.isPending) {
    return <BoardState busy status="Loading project workflows…" />
  }

  if (metadata.isError) {
    return (
      <BoardState
        alert
        status="Project workflows are unavailable."
        actionLabel="Retry board"
        onAction={() => {
          void metadata.refetch()
        }}
      />
    )
  }

  if (!selectedProject) {
    return (
      <BoardState status="There are no active project workflows to display." />
    )
  }

  const handleProjectChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const nextProjectId = event.currentTarget.value
    setAnnouncement(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('project', nextProjectId)
      return next
    })
  }

  const moveToStatus = (issue: Issue, statusId: WorkflowStatusId): void => {
    const targetStatus = selectedProject.statuses.find(({ id }) => id === statusId)
    setAnnouncement(null)
    moveIssue.mutate(
      { issue, statusId },
      {
        onSuccess: () => {
          setAnnouncement(`${issue.title} moved to ${targetStatus?.name ?? 'status'}.`)
        },
        onError: (error) => {
          setAnnouncement(formatMoveError(error, issue.title))
        },
      },
    )
  }

  const handleStatusChange = (
    issue: Issue,
    event: ChangeEvent<HTMLSelectElement>,
  ): void => {
    moveToStatus(
      issue,
      parseStatusId(
        event.currentTarget.value,
        selectedProject.statuses.map(({ id }) => id),
      ),
    )
  }

  const handleDragStart = (
    issue: Issue,
    event: DragEvent<HTMLButtonElement>,
  ): void => {
    if (!authorization.can('issue:update', issue.projectId) || moveIssue.isPending) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', issue.id)
    setDraggedIssueId(issue.id)
    setDragTargetStatusId(null)
    setAnnouncement(`Dragging ${issue.title}. Drop it on a workflow column.`)
  }

  const handleDragEnd = (): void => {
    setDraggedIssueId(null)
    setDragTargetStatusId(null)
  }

  const handleDragOver = (
    statusId: WorkflowStatusId,
    event: DragEvent<HTMLElement>,
  ): void => {
    const draggedIssue = loadedIssues.find(({ id }) => id === draggedIssueId)
    if (!draggedIssue || moveIssue.isPending) return
    if (draggedIssue.statusId === statusId) {
      setDragTargetStatusId(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragTargetStatusId(statusId)
  }

  const handleDrop = (
    statusId: WorkflowStatusId,
    event: DragEvent<HTMLElement>,
  ): void => {
    event.preventDefault()
    const transferredIssueId = event.dataTransfer.getData('text/plain')
    const issue = loadedIssues.find(
      ({ id }) => id === draggedIssueId && id === transferredIssueId,
    )
    setDraggedIssueId(null)
    setDragTargetStatusId(null)
    if (!issue || issue.statusId === statusId) return
    if (!authorization.can('issue:update', issue.projectId)) {
      setAnnouncement(`${issue.title} cannot be moved with your current permissions.`)
      return
    }
    setDragFocusIssueId(issue.id)
    moveToStatus(issue, statusId)
  }

  return (
    <section className="page board-page" aria-labelledby="board-title">
      <header className="board-header">
        <div>
          <p className="page-eyebrow">Delivery workflow</p>
          <h1 id="board-title">Board</h1>
          <p>Move work through the project workflow with keyboard-ready controls.</p>
        </div>
        <label className="board-project-picker">
          <span>Project</span>
          <select value={selectedProject.project.id} onChange={handleProjectChange}>
            {metadata.data.projects.map(({ project }) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <p className="board-instructions" id="board-move-instructions">
        Drag an issue by its handle, or use its status menu as a keyboard-accessible
        alternative. Changes save immediately and return to the previous status if
        the request fails. Blocking issues must reach a completed stage before
        dependent work can be completed.
      </p>

      {issues.isPending ? (
        <div className="board-state" role="status" aria-busy="true">
          Loading {selectedProject.project.name} issues…
        </div>
      ) : null}

      {issues.isError ? (
        <div className="board-state board-state--error" role="alert">
          <h2>Board issues are unavailable</h2>
          <p>The current project could not be loaded. Try the request again.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              void issues.refetch()
            }}
          >
            Retry issues
          </button>
        </div>
      ) : null}

      {issues.isSuccess ? (
        <div
          className="kanban-board"
          aria-label={`${selectedProject.project.name} workflow board`}
        >
          {selectedProject.statuses.map((status) => {
            const statusIssues = loadedIssues.filter(
              ({ statusId }) => statusId === status.id,
            )

            return (
              <section
                className="kanban-column"
                aria-labelledby={`status-${status.id}`}
                data-drag-target={dragTargetStatusId === status.id || undefined}
                key={status.id}
                onDragOver={(event) => {
                  handleDragOver(status.id, event)
                }}
                onDrop={(event) => {
                  handleDrop(status.id, event)
                }}
              >
                <header className="kanban-column__header">
                  <h2 id={`status-${status.id}`}>{status.name}</h2>
                  <span
                    aria-label={`${String(statusIssues.length)} loaded ${statusIssues.length === 1 ? 'issue' : 'issues'}`}
                  >
                    {statusIssues.length}
                  </span>
                </header>
                {statusIssues.length === 0 ? (
                  <p className="kanban-column__empty">
                    {issues.hasNextPage
                      ? 'No loaded issues in this status.'
                      : 'No issues in this status.'}
                  </p>
                ) : (
                  <ol className="kanban-card-list">
                    {statusIssues.map((issue) => {
                      const canMove = authorization.can('issue:update', issue.projectId)
                      const isMoving =
                        moveIssue.isPending && moveIssue.variables.issue.id === issue.id

                      return (
                        <li key={issue.id}>
                          <article
                            className="kanban-card"
                            data-dragging={draggedIssueId === issue.id || undefined}
                          >
                            <p className="kanban-card__identifier">
                              {selectedProject.project.key}-{issue.number} · {issue.type}
                            </p>
                            <h3>
                              <Link to={`/issues/${issue.id}`}>{issue.title}</Link>
                            </h3>
                            <div className="kanban-card__meta">
                              <span className={`priority-badge priority-badge--${issue.priority}`}>
                                {formatPriority(issue.priority)}
                              </span>
                              {issue.dueDate ? <span>Due {issue.dueDate}</span> : null}
                            </div>
                            <button
                              className="kanban-card__drag-handle"
                              type="button"
                              draggable={canMove && !moveIssue.isPending}
                              disabled={!canMove || moveIssue.isPending}
                              aria-describedby="board-move-instructions"
                              ref={(element) => {
                                if (element) dragHandleRefs.current.set(issue.id, element)
                                else dragHandleRefs.current.delete(issue.id)
                              }}
                              onDragStart={(event) => {
                                handleDragStart(issue, event)
                              }}
                              onDragEnd={handleDragEnd}
                            >
                              Drag {issue.title}
                            </button>
                            <label className="kanban-card__move">
                              <span>Move {issue.title}</span>
                              <select
                                aria-describedby="board-move-instructions"
                                value={issue.statusId}
                                disabled={!canMove || isMoving || moveIssue.isPending}
                                onChange={(event) => {
                                  handleStatusChange(issue, event)
                                }}
                              >
                                {selectedProject.statuses.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </article>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            )
          })}
        </div>
      ) : null}

      {issues.isSuccess && totalIssues > 50 ? (
        <div className="board-pagination">
          <p>
            Showing {String(loadedIssues.length)} of {String(totalIssues)} issues.
          </p>
          {issues.hasNextPage ? (
            <button
              className="secondary-button"
              type="button"
              disabled={issues.isFetchingNextPage}
              onClick={() => void issues.fetchNextPage()}
            >
              {issues.isFetchingNextPage ? 'Loading more issues…' : 'Load more issues'}
            </button>
          ) : null}
        </div>
      ) : null}

      <p
        className="board-announcement"
        role={moveIssue.isError ? 'alert' : 'status'}
        aria-live="polite"
      >
        {announcement}
      </p>
    </section>
  )
}

interface BoardStateProps {
  readonly actionLabel?: string
  readonly alert?: boolean
  readonly busy?: boolean
  readonly onAction?: () => void
  readonly status: string
}

function BoardState({
  actionLabel,
  alert = false,
  busy = false,
  onAction,
  status,
}: BoardStateProps) {
  return (
    <section className="page" aria-labelledby="board-title">
      <header className="page-header">
        <p className="page-eyebrow">Delivery workflow</p>
        <h1 id="board-title">Board</h1>
        <p>Move work through project workflows with accessible controls.</p>
      </header>
      <div
        className={`board-state${alert ? ' board-state--error' : ''}`}
        role={alert ? 'alert' : 'status'}
        aria-busy={busy || undefined}
      >
        <p>{status}</p>
        {actionLabel && onAction ? (
          <button className="secondary-button" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  )
}

function parseStatusId(
  value: string,
  validStatusIds: readonly WorkflowStatusId[],
): WorkflowStatusId {
  const statusId = validStatusIds.find((candidate) => candidate === value)
  if (!statusId) throw new TypeError(`Unsupported workflow status: ${value}`)
  return statusId
}

function formatMoveError(error: Error, issueTitle: string): string {
  if (hasAppErrorKind(error, 'conflict')) {
    return `${issueTitle} changed elsewhere. The latest board state has been restored.`
  }

  if (hasAppErrorKind(error, 'invalid-request')) {
    return `${error.message} The previous status has been restored.`
  }

  return `${issueTitle} could not be moved. Its previous status has been restored.`
}

function formatPriority(priority: Issue['priority']): string {
  return priority === 'none'
    ? 'No priority'
    : `${priority[0]?.toLocaleUpperCase() ?? ''}${priority.slice(1)}`
}
