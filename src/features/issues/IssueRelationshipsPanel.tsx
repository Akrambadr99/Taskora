import { useId, useState, type SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuthorization } from '../../app/providers/authorization-context'
import type { IssueRelationshipData } from '../../data'
import type { IssueId, IssueRelation, IssueRelationType } from '../../domain'
import {
  useChangeIssueRelationships, useIssueRelationships, type RelationshipChange,
} from './issue-relationship-queries'
import './issue-relationships.css'

export function IssueRelationshipsPanel({ issueId, canEdit }: Readonly<{ issueId: IssueId; canEdit: boolean }>) {
  const query = useIssueRelationships(issueId)
  const mutation = useChangeIssueRelationships(issueId)
  const authorization = useAuthorization()
  const titleId = useId()
  const [status, setStatus] = useState('')
  const save = (change: RelationshipChange) => {
    setStatus('')
    mutation.mutate(change, { onSuccess: () => { setStatus('Relationships saved.') } })
  }
  return (
    <section className="issue-relationships" aria-labelledby={titleId}>
      <h2 id={titleId}>Dependencies and hierarchy</h2>
      <p>Blocking links point from the prerequisite to the issue waiting on it. Links are limited to this project.</p>
      {query.isPending ? <p>Loading relationships...</p> : null}
      {query.isError ? <p role="alert">Unable to load relationships. Refresh to try again.</p> : null}
      <button type="button" className="secondary-button" disabled={query.isFetching || mutation.isPending}
        onClick={() => { mutation.reset(); setStatus(''); void query.refetch() }}>
        Refresh relationships
      </button>
      {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
      {status ? <p role="status">{status}</p> : null}
      {query.data && !query.isError ? (
        <RelationshipEditor
          key={`${issueId}:${query.data.issue.revision.toString()}:${authorization.session.permissionFingerprint}`}
          data={query.data}
          canEdit={canEdit}
          disabled={query.isFetching || mutation.isPending}
          save={save}
        />
      ) : null}
    </section>
  )
}

function RelationshipEditor({ data, canEdit, disabled, save }: Readonly<{
  data: IssueRelationshipData
  canEdit: boolean
  disabled: boolean
  save(change: RelationshipChange): void
}>) {
  const [targetId, setTargetId] = useState('')
  const [type, setType] = useState<IssueRelationType>('blocks')
  const [parentId, setParentId] = useState<string>(data.issue.parentIssueId ?? '')
  const options = data.projectIssues.filter(({ id }) => id !== data.issue.id)
  const parent = data.projectIssues.find(({ id }) => id === data.issue.parentIssueId)
  const children = data.projectIssues.filter(({ parentIssueId }) => parentIssueId === data.issue.id)
  const add = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = options.find(({ id }) => id === targetId)
    if (!target || !canEdit || disabled) return
    save({ kind: 'add', input: {
      sourceIssueId: data.issue.id, targetIssueId: target.id, type,
      expectedSourceRevision: data.issue.revision, expectedTargetRevision: target.revision,
    } })
  }
  const remove = (relation: IssueRelation) => {
    const source = data.projectIssues.find(({ id }) => id === relation.sourceIssueId)
    const target = data.projectIssues.find(({ id }) => id === relation.targetIssueId)
    if (!source || !target || !canEdit || disabled) return
    save({ kind: 'remove', input: {
      id: relation.id, expectedSourceRevision: source.revision, expectedTargetRevision: target.revision,
    } })
  }
  const updateParent = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selected = options.find(({ id }) => id === parentId)
    if (!canEdit || disabled || (parentId !== '' && !selected)) return
    save({ kind: 'parent', input: {
      id: data.issue.id, expectedRevision: data.issue.revision,
      changes: { parentIssueId: selected?.id ?? null },
    } })
  }
  return (
    <>
      <h3>Linked issues</h3>
      {data.relations.length === 0 ? <p>No linked issues.</p> : (
        <ul className="issue-relationships-list" aria-label="Linked issues">
          {data.relations.map((relation) => {
            const outgoing = relation.sourceIssueId === data.issue.id
            const otherId = outgoing ? relation.targetIssueId : relation.sourceIssueId
            const other = data.projectIssues.find(({ id }) => id === otherId)
            const label = relationshipLabel(relation.type, outgoing)
            return (
              <li key={relation.id}>
                <span>{label}: <Link to={`/issues/${otherId}`}>{other?.title ?? otherId}</Link></span>
                {canEdit ? <button type="button" className="secondary-button" disabled={disabled}
                  aria-label={`Remove ${label.toLowerCase()} ${other?.title ?? otherId}`}
                  onClick={() => { remove(relation) }}>Remove link</button> : null}
              </li>
            )
          })}
        </ul>
      )}
      {canEdit ? (
        <form aria-label="Add issue relationship" onSubmit={add}>
          <fieldset disabled={disabled}>
            <legend>Add a link from this issue</legend>
            <label>Relationship
              <select value={type} onChange={(event) => { setType(event.target.value as IssueRelationType) }}>
                <option value="blocks">Blocks</option>
                <option value="relates-to">Related to</option>
                <option value="duplicates">Duplicates</option>
              </select>
            </label>
            <label>Target issue
              <select required value={targetId} onChange={(event) => { setTargetId(event.target.value) }}>
                <option value="">Choose an issue</option>
                {options.map((issue) => <option key={issue.id} value={issue.id}>#{issue.number} {issue.title}</option>)}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={targetId === ''}>Add relationship</button>
          </fieldset>
        </form>
      ) : <p>Relationships are read-only.</p>}
      <h3>Parent and children</h3>
      <p>Parent: {parent ? <Link to={`/issues/${parent.id}`}>{parent.title}</Link> : 'None'}</p>
      {children.length > 0 ? (
        <ul aria-label="Child issues">{children.map((issue) => (
          <li key={issue.id}><Link to={`/issues/${issue.id}`}>{issue.title}</Link></li>
        ))}</ul>
      ) : <p>No child issues.</p>}
      {canEdit ? (
        <form aria-label="Change issue parent" onSubmit={updateParent}>
          <fieldset disabled={disabled}>
            <legend>Change parent</legend>
            <label>Parent issue
              <select value={parentId} onChange={(event) => { setParentId(event.target.value) }}>
                <option value="">No parent</option>
                {options.map((issue) => <option key={issue.id} value={issue.id}>#{issue.number} {issue.title}</option>)}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={parentId === (data.issue.parentIssueId ?? '')}>Save parent</button>
          </fieldset>
        </form>
      ) : null}
    </>
  )
}

function relationshipLabel(type: IssueRelationType, outgoing: boolean): string {
  switch (type) {
    case 'blocks': return outgoing ? 'Blocks' : 'Blocked by'
    case 'duplicates': return outgoing ? 'Duplicates' : 'Duplicated by'
    case 'relates-to': return 'Related to'
  }
}
