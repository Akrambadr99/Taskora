import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { WorkspaceBackupPanel } from './WorkspaceBackupPanel'
import { AppProviders } from '../providers/AppProviders'
import { createAppServices } from '../services'
import { createAtlasQueryClient } from '../query-client'
import { createAtlasFixtures, InMemoryDataStore, SimulatedNetwork } from '../../data'
import { render, screen, waitFor } from '../../test/render'

async function setup(content?: string) {
  const store = new InMemoryDataStore(createAtlasFixtures())
  const services = createAppServices({ dataStore: store, simulator: new SimulatedNetwork() })
  const archive = content ?? await services.gateway.exportWorkspaceBackup(services.workspaceId)
  render(<AppProviders services={services} queryClient={createAtlasQueryClient()}><WorkspaceBackupPanel /></AppProviders>)
  const user = userEvent.setup()
  const file = new File([archive], 'backup.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(archive) })
  await user.upload(screen.getByLabelText('Workspace backup file'), file)
  await user.click(screen.getByRole('button', { name: 'Preview recovery' }))
  return { user, store }
}

describe('workspace backup controls', () => {
  it('requires typed confirmation and refreshes after successful replacement', async () => {
    const { user, store } = await setup()
    await screen.findByRole('dialog', { name: 'Confirm workspace recovery' })
    const replace = screen.getByRole('button', { name: 'Replace workspace data' })
    expect(replace).toBeDisabled()
    expect(screen.getByRole('table', { name: 'Workspace recovery changes' })).toBeVisible()
    const name = store.read().data.workspaces[0]?.name
    if (!name) throw new Error('Expected workspace')
    await user.type(screen.getByRole('textbox', { name: /to confirm/ }), name)
    await user.click(replace)
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument() })
    expect(await screen.findByText(/Workspace restored/)).toBeVisible()
    expect(store.read().version).toBe(1)
  })

  it('cancels with Escape without replacing state and restores focus', async () => {
    const { user, store } = await setup()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview recovery' })).toHaveFocus()
    expect(store.read().version).toBe(0)
  })

  it('announces corrupt files without offering replacement', async () => {
    const { store } = await setup('{broken')
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(store.read().version).toBe(0)
  })

  it('keeps a stale conflict visible and lets the user cancel safely', async () => {
    const { user, store } = await setup()
    await screen.findByRole('dialog')
    const name = store.read().data.workspaces[0]?.name
    if (!name) throw new Error('Expected workspace')
    store.commit(0, store.read().data)
    await user.type(screen.getByRole('textbox', { name: /to confirm/ }), name)
    await user.click(screen.getByRole('button', { name: 'Replace workspace data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace changed')
    await user.click(screen.getByRole('button', { name: 'Cancel recovery' }))
    expect(store.read().version).toBe(1)
  })
})
