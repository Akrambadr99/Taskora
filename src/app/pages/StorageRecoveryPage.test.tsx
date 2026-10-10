import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageRecoveryPage } from './StorageRecoveryPage'
import { render, screen, waitFor } from '../../test/render'
import { workspaceStorageKey } from '../../data'

afterEach(() => { window.localStorage.clear(); Reflect.deleteProperty(navigator, 'locks') })

describe('storage recovery screen', () => {
  it('requires explicit reset and preserves data until confirmation', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: <T,>(_name: string, action: () => T): Promise<T> => Promise.resolve(action()),
    } })
    const user = userEvent.setup()
    const retry = vi.fn()
    window.localStorage.setItem(workspaceStorageKey, '{damaged')
    render(<StorageRecoveryPage failure={{ message: 'Corrupt workspace', raw: '{damaged' }} onRetry={retry} />)
    const reset = screen.getByRole('button', { name: 'Reset local workspace' })
    expect(reset).toBeDisabled()
    expect(window.localStorage.getItem(workspaceStorageKey)).toBe('{damaged')
    await user.type(screen.getByRole('textbox'), 'RESET')
    await user.click(reset)
    await waitFor(() => { expect(retry).toHaveBeenCalledOnce() })
    expect(window.localStorage.getItem(workspaceStorageKey)).not.toBe('{damaged')
  })

  it('leaves unavailable storage alone and offers retry', async () => {
    const retry = vi.fn()
    render(<StorageRecoveryPage failure={{ message: 'Unavailable', raw: undefined }} onRetry={retry} />)
    expect(screen.getByRole('button', { name: 'Download saved data for recovery' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset local workspace' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading workspace' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
