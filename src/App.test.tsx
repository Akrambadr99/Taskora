import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from './App'
import { render, screen } from './test/render'

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: <T,>(_name: string, action: () => T): Promise<T> => Promise.resolve(action()),
    } })
  })
  afterEach(() => { window.localStorage.clear(); Reflect.deleteProperty(navigator, 'locks') })

  it('renders the dashboard inside the application shell', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible()
    expect(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).toBeVisible()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    expect(await screen.findByText('Tracked issues')).toBeVisible()
  })
})
