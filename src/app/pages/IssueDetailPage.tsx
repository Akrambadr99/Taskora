import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type SyntheticEvent,
} from 'react'
import { Link, useParams } from 'react-router-dom'

import { ModalDialog } from '../../components/dialog/ModalDialog'
import { GatewayConflictError } from '../../data'
import { IssueRelationshipsPanel } from '../../features/issues/IssueRelationshipsPanel'
import { CommentItem } from '../../features/comments/CommentItem'
import {
  issueId,
  type Issue,
  type IssueId,
  type IssuePriority,
  type User,
  type UserId,
} from '../../domain'
import {
  useIssueDetailData,
  useIssueActivityData,
  useCreateIssueComment,
  useOptimisticIssueUpdate,
} from '../../features/issues/issue-detail-queries'
import {
  useIssueSubscriptionData,
  useSetIssueSubscription,
} from '../../features/issues/issue-subscription-queries'
import {
  validateIssueEditDraft,
  type IssueEditDraft,
} from '../../features/issues/issue-form'
import { hasAppErrorKind } from '../errors/classify-app-error'
import { useAuthorization } from '../providers/authorization-context'
import './issues-page.css'
import './pages.css'

const priorities: readonly IssuePriority[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
]

export function IssueDetailPage() {
  const requestedIssueId = parseIssueId(useParams<{ issueId: string }>().issueId)
  return requestedIssueId ? (
    <LoadedIssue requestedIssueId={requestedIssueId} />
  ) : (
    <IssueNotFound />
  )
}

function LoadedIssue({ requestedIssueId }: Readonly<{ requestedIssueId: IssueId }>) {
  const authorization = useAuthorization()
  const { issue, projects } = useIssueDetailData(requestedIssueId)
  const activity = useIssueActivityData(requestedIssueId)
  const subscription = useIssueSubscriptionData(requestedIssueId)
  const [editorPermissionFingerprint, setEditorPermissionFingerprint] = useState<
    string | null
  >(null)
  const [status, setStatus] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const loadedIssue = issue.data
  const project = projects.data?.find(({ id }) => id === loadedIssue?.projectId)
  const projectIsWritable =
    project?.status === 'planned' ||
    project?.status === 'active' ||
    project?.status === 'paused'
  const canEdit = Boolean(
    loadedIssue &&
    projectIsWritable &&
    authorization.can('issue:update', loadedIssue.projectId),
  )
  const accessChangedWhileEditing =
    editorPermissionFingerprint !== null &&
    (!canEdit ||
      editorPermissionFingerprint !== authorization.session.permissionFingerprint)
  const editing =
    editorPermissionFingerprint !== null && !accessChangedWhileEditing
  const displayedStatus = accessChangedWhileEditing
    ? 'Your issue editing permission changed. No changes were saved.'
    : status

  useEffect(() => {
    if (!accessChangedWhileEditing) return
    statusRef.current?.focus()
  }, [accessChangedWhileEditing])

  if (issue.isPending || projects.isPending) {
    return <IssueState role="status" message="Loading issue…" />
  }

  if (issue.isError || projects.isError) {
    const notFound = hasAppErrorKind(issue.error, 'not-found')
    if (notFound) return <IssueNotFound />

    return (
      <section className="page" aria-labelledby="issue-detail-title">
        <IssueHeader title="Issue unavailable" />
        <div className="dashboard-state dashboard-state--error" role="alert">
          <p>The local service could not load this issue.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void Promise.all([issue.refetch(), projects.refetch()])}
          >
            Retry issue
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page" aria-labelledby="issue-detail-title">
      <header className="issue-detail-header">
        <Link className="text-link" to="/issues">
          ← Issues
        </Link>
        <div>
          <p className="page-eyebrow">
            {project?.key ?? 'Issue'}-{issue.data.number} · Revision {issue.data.revision}
          </p>
          <h1 id="issue-detail-title">{issue.data.title}</h1>
          <p>{issue.data.description || 'No description provided.'}</p>
        </div>
        {canEdit ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setStatus('')
              setEditorPermissionFingerprint(
                authorization.session.permissionFingerprint,
              )
            }}
          >
            Edit issue
          </button>
        ) : (
          <p className="page-eyebrow">Read-only access</p>
        )}
      </header>

      {displayedStatus ? (
        <p ref={statusRef} className="bulk-status" role="status" tabIndex={-1}>
          {displayedStatus}
        </p>
      ) : null}

      <dl className="issue-detail-grid">
        <div>
          <dt>Project</dt>
          <dd>{project?.name ?? 'Unknown project'}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{capitalize(issue.data.priority)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{capitalize(issue.data.type)}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd>{issue.data.dueDate ?? 'Not scheduled'}</dd>
        </div>
      </dl>

      <IssueRelationshipsPanel key={issue.data.id} issueId={issue.data.id} canEdit={canEdit} />

      <IssueWatchPanel
        issue={issue.data}
        subscription={subscription}
        canSubscribe={authorization.can('issue:subscribe', issue.data.projectId)}
      />

      <IssueCollaboration
        issue={issue.data}
        activity={activity}
        canComment={
          projectIsWritable &&
          authorization.can('comment:create', issue.data.projectId)
        }
        readOnly={!projectIsWritable}
      />

      {editing ? (
        <IssueEditDialog
          issue={issue.data}
          onClose={() => {
            setEditorPermissionFingerprint(null)
          }}
          onSaved={() => {
            setEditorPermissionFingerprint(null)
            setStatus('Issue changes saved.')
          }}
        />
      ) : null}
    </section>
  )
}

function IssueWatchPanel({
  issue,
  subscription,
  canSubscribe,
}: Readonly<{
  issue: Issue
  subscription: ReturnType<typeof useIssueSubscriptionData>
  canSubscribe: boolean
}>) {
  const update = useSetIssueSubscription(issue.id)
  const [status, setStatus] = useState('')

  return (
    <section className="issue-watchers" aria-labelledby="issue-watchers-title">
      <div>
        <p className="page-eyebrow">Collaboration</p>
        <h2 id="issue-watchers-title">Watchers</h2>
        <p>Watch this issue to receive comment notifications.</p>
      </div>
      {subscription.isPending ? (
        <p role="status">Loading watchers…</p>
      ) : subscription.isError ? (
        <div className="issue-watchers__error" role="alert">
          <span>Watchers could not be loaded.</span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void subscription.refetch()}
          >
            Retry watchers
          </button>
        </div>
      ) : (
        <>
          <div className="issue-watchers__summary">
            <p>
              {subscription.data.subscribers.length.toString()}{' '}
              {subscription.data.subscribers.length === 1 ? 'watcher' : 'watchers'}
            </p>
            {canSubscribe ? (
              <button
                className="secondary-button"
                type="button"
                aria-pressed={subscription.data.subscribed}
                disabled={update.isPending}
                onClick={() => {
                  const subscribed = !subscription.data.subscribed
                  setStatus('')
                  update.mutate(
                    {
                      issueId: issue.id,
                      expectedSubscribed: subscription.data.subscribed,
                      subscribed,
                    },
                    {
                      onSuccess: () => {
                        setStatus(
                          subscribed
                            ? 'You are now watching this issue.'
                            : 'You stopped watching this issue.',
                        )
                      },
                      onError: (error) => {
                        setStatus(
                          error instanceof GatewayConflictError
                            ? 'Watch state changed in another session. Current state restored.'
                            : 'Watch state could not be updated. Previous state restored.',
                        )
                      },
                    },
                  )
                }}
              >
                {update.isPending
                  ? 'Updating…'
                  : subscription.data.subscribed
                    ? 'Stop watching'
                    : 'Watch issue'}
              </button>
            ) : null}
          </div>
          {subscription.data.subscribers.length > 0 ? (
            <ul className="issue-watchers__list" aria-label="People watching this issue">
              {subscription.data.subscribers.map((subscriber) => (
                <li key={subscriber.id}>{subscriber.displayName}</li>
              ))}
            </ul>
          ) : (
            <p className="issue-collaboration__empty">No one is watching yet.</p>
          )}
        </>
      )}
      {status ? <p className="issue-watchers__status" role="status">{status}</p> : null}
    </section>
  )
}

function IssueCollaboration({
  issue,
  activity,
  canComment,
  readOnly,
}: Readonly<{
  issue: Issue
  activity: ReturnType<typeof useIssueActivityData>
  canComment: boolean
  readOnly: boolean
}>) {
  if (activity.isPending) {
    return (
      <section className="issue-collaboration" aria-label="Issue collaboration">
        <div className="dashboard-state" role="status">
          Loading comments and activity…
        </div>
      </section>
    )
  }

  if (activity.isError) {
    return (
      <section className="issue-collaboration" aria-label="Issue collaboration">
        <div className="dashboard-state dashboard-state--error" role="alert">
          <p>Comments and activity could not be loaded.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void activity.refetch()}
          >
            Retry history
          </button>
        </div>
      </section>
    )
  }

  const usersById = new Map(activity.data.users.map((user) => [user.id, user]))

  return (
    <section className="issue-collaboration" aria-label="Issue collaboration">
      <div className="issue-collaboration__column">
        <header>
          <p className="page-eyebrow">Discussion</p>
          <h2>Comments</h2>
        </header>
        {canComment ? (
          <CommentForm
            issueId={issue.id}
            mentionableUsers={activity.data.mentionableUsers}
          />
        ) : null}
        {activity.data.comments.length === 0 ? (
          <p className="issue-collaboration__empty">No comments yet.</p>
        ) : (
          <ol className="comment-list">
            {activity.data.comments.map((comment) => (
              <CommentItem
                key={comment.id}
                issueId={issue.id}
                mentionableUsers={activity.data.mentionableUsers}
                mentionedUserIds={activity.data.commentMentions
                  .filter(({ commentId }) => commentId === comment.id)
                  .map(({ userId }) => userId)}
                projectId={issue.projectId}
                readOnly={readOnly}
                comment={comment}
                authorName={
                  usersById.get(comment.authorId)?.displayName ?? 'Unknown member'
                }
                deletedByName={
                  comment.deletedById
                    ? (usersById.get(comment.deletedById)?.displayName ??
                      'Unknown moderator')
                    : null
                }
              />
            ))}
          </ol>
        )}
      </div>
      <div className="issue-collaboration__column">
        <header>
          <p className="page-eyebrow">Record</p>
          <h2>Activity</h2>
        </header>
        {activity.data.activityEvents.length === 0 ? (
          <p className="issue-collaboration__empty">No activity recorded yet.</p>
        ) : (
          <ol className="activity-list">
            {activity.data.activityEvents.map((event) => (
              <li key={event.id}>
                <span className="activity-list__marker" aria-hidden="true" />
                <div>
                  <p>
                    <strong>
                      {usersById.get(event.actorId)?.displayName ?? 'Unknown member'}
                    </strong>{' '}
                    {event.summary}
                  </p>
                  <time dateTime={event.occurredAt}>
                    {formatTimestamp(event.occurredAt)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function CommentForm({
  issueId,
  mentionableUsers,
}: Readonly<{ issueId: IssueId; mentionableUsers: readonly User[] }>) {
  const createComment = useCreateIssueComment(issueId)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const submissionPendingRef = useRef(false)
  const [body, setBody] = useState('')
  const [mentionUserId, setMentionUserId] = useState('')
  const [selectedMentionUserIds, setSelectedMentionUserIds] = useState<readonly UserId[]>([])
  const [validationError, setValidationError] = useState('')
  const [status, setStatus] = useState('')

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submissionPendingRef.current) return
    const normalized = body.trim()
    setStatus('')
    if (normalized.length === 0 || normalized.length > 5_000) {
      setValidationError('Enter a comment between 1 and 5,000 characters.')
      return
    }

    setValidationError('')
    submissionPendingRef.current = true
    const mentionedUserIds = selectedMentionUserIds.filter((userId) => {
      const user = mentionableUsers.find(({ id }) => id === userId)
      return user ? normalized.includes(`@${user.displayName}`) : false
    })
    createComment.mutate({ body: normalized, mentionedUserIds }, {
      onSuccess: () => {
        setBody('')
        setSelectedMentionUserIds([])
        setStatus('Comment added.')
        textAreaRef.current?.focus()
      },
      onSettled: () => {
        submissionPendingRef.current = false
      },
    })
  }

  return (
    <form className="comment-form" aria-label="Add comment" onSubmit={handleSubmit}>
      <label htmlFor="new-comment">Add a comment</label>
      <textarea
        ref={textAreaRef}
        id="new-comment"
        rows={4}
        maxLength={5_001}
        value={body}
        aria-invalid={Boolean(validationError)}
        aria-describedby="comment-guidance"
        onChange={(event) => {
          setBody(event.currentTarget.value)
        }}
      />
      {mentionableUsers.length > 0 ? (
        <div className="comment-form__mentions" aria-label="Mention a workspace member">
          <label htmlFor={`mention-member-${issueId}`}>Member to mention</label>
          <select
            id={`mention-member-${issueId}`}
            value={mentionUserId}
            onChange={(event) => { setMentionUserId(event.currentTarget.value) }}
          >
            <option value="">Choose a member</option>
            {mentionableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName} ({user.email})
              </option>
            ))}
          </select>
          <button
            className="text-button"
            type="button"
            disabled={mentionUserId.length === 0}
            onClick={() => {
              const user = mentionableUsers.find(({ id }) => id === mentionUserId)
              if (!user) return
              const token = `@${user.displayName}`
              setBody((current) =>
                current.includes(token)
                  ? current
                  : `${current}${current.length > 0 && !current.endsWith(' ') ? ' ' : ''}${token} `,
              )
              setSelectedMentionUserIds((current) =>
                current.includes(user.id) ? current : [...current, user.id],
              )
              setMentionUserId('')
              textAreaRef.current?.focus()
            }}
          >
            Insert mention
          </button>
        </div>
      ) : null}
      <div className="comment-form__footer">
        <p id="comment-guidance">
          {validationError ||
            `${body.length.toString()} of 5,000 characters. Commenting watches this issue.`}
        </p>
        <button
          className="primary-button"
          type="submit"
          disabled={createComment.isPending}
        >
          {createComment.isPending ? 'Adding…' : 'Add comment'}
        </button>
      </div>
      {createComment.isError ? (
        <p className="form-error" role="alert">
          {createComment.error.message}
        </p>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
    </form>
  )
}

function IssueEditDialog({
  issue,
  onClose,
  onSaved,
}: Readonly<{ issue: Issue; onClose: () => void; onSaved: () => void }>) {
  const update = useOptimisticIssueUpdate(issue.id)
  const [draft, setDraft] = useState<IssueEditDraft>(() => ({
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    dueDate: issue.dueDate ?? '',
  }))
  const [errors, setErrors] = useState<
    ReturnType<typeof validateIssueEditDraft>['errors']
  >({})
  const [submitError, setSubmitError] = useState('')

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validation = validateIssueEditDraft(draft)
    setErrors(validation.errors)
    setSubmitError('')
    if (!validation.changes) return

    update.mutate(
      { issue, changes: validation.changes },
      {
        onSuccess: onSaved,
        onError: (error) => {
          setSubmitError(
            error instanceof GatewayConflictError
              ? 'This issue changed elsewhere. The latest revision is loaded; review your draft and retry.'
              : error.message,
          )
        },
      },
    )
  }

  return (
    <ModalDialog
      titleId="issue-edit-title"
      descriptionId="issue-edit-description"
      onRequestClose={onClose}
    >
      <form className="issue-edit-form" onSubmit={handleSubmit} noValidate>
        <div>
          <p className="page-eyebrow">Issue editor</p>
          <h2 id="issue-edit-title">Edit issue</h2>
          <p id="issue-edit-description">
            Update the issue without losing concurrent changes.
          </p>
        </div>
        <FormField label="Title" error={errors.title}>
          <input
            aria-invalid={Boolean(errors.title)}
            value={draft.title}
            maxLength={161}
            onChange={(event) => {
              setDraft({ ...draft, title: event.currentTarget.value })
            }}
          />
        </FormField>
        <FormField label="Description" error={errors.description}>
          <textarea
            aria-invalid={Boolean(errors.description)}
            value={draft.description}
            rows={5}
            onChange={(event) => {
              setDraft({ ...draft, description: event.currentTarget.value })
            }}
          />
        </FormField>
        <div className="issue-edit-form__row">
          <FormField label="Priority">
            <select
              value={draft.priority}
              onChange={(event) => {
                const priority = priorities.find(
                  (candidate) => candidate === event.currentTarget.value,
                )
                if (priority) setDraft({ ...draft, priority })
              }}
            >
              {priorities.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Due date" error={errors.dueDate}>
            <input
              type="date"
              aria-invalid={Boolean(errors.dueDate)}
              value={draft.dueDate}
              onChange={(event) => {
                setDraft({ ...draft, dueDate: event.currentTarget.value })
              }}
            />
          </FormField>
        </div>
        {submitError ? (
          <p className="form-error" role="alert">
            {submitError}
          </p>
        ) : null}
        <div className="issue-edit-form__actions">
          <button className="primary-button" type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={update.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </form>
    </ModalDialog>
  )
}

function FormField({
  label,
  error,
  children,
}: Readonly<{
  label: string
  error?: string | undefined
  children: ReactElement
}>) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {error ? <span className="form-field__error">{error}</span> : null}
    </label>
  )
}

function IssueState({ role, message }: Readonly<{ role: 'status'; message: string }>) {
  return (
    <section className="page">
      <IssueHeader title="Issue" />
      <div className="dashboard-state" role={role}>
        {message}
      </div>
    </section>
  )
}

function IssueNotFound() {
  return (
    <section className="page">
      <IssueHeader title="Issue not found" />
      <div className="empty-panel">
        <p>The requested issue does not exist.</p>
        <Link className="text-link" to="/issues">
          Return to issues
        </Link>
      </div>
    </section>
  )
}

function IssueHeader({ title }: Readonly<{ title: string }>) {
  return (
    <header className="page-header">
      <p className="page-eyebrow">Workspace issue</p>
      <h1 id="issue-detail-title">{title}</h1>
    </header>
  )
}

function parseIssueId(value: string | undefined): IssueId | null {
  if (!value) return null
  try {
    return issueId(value)
  } catch {
    return null
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}
