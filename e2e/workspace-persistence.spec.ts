/// <reference lib="dom" />
import { chromium, expect, test } from '@playwright/test'

const priorityName = 'Priority for Publish the launch readiness brief'
const storageKey = 'taskora:workspace'

test('keeps an edit after a real persistent-browser restart', async ({ baseURL }, testInfo) => {
  const url = baseURL ?? 'http://127.0.0.1:4173/'
  const profile = testInfo.outputPath('workspace-browser-profile')
  const first = await chromium.launchPersistentContext(profile, { headless: true })
  try {
    const page = await first.newPage()
    await page.goto(url)
    await page.getByRole('combobox', { name: priorityName }).selectOption('low')
    await expect(page.getByText('Priority updated for Publish the launch readiness brief.')).toBeVisible()
  } finally { await first.close() }
  const reopened = await chromium.launchPersistentContext(profile, { headless: true })
  try {
    const page = await reopened.newPage()
    await page.goto(url)
    await expect(page.getByRole('combobox', { name: priorityName })).toHaveValue('low')
  } finally { await reopened.close() }
})

test('synchronizes workspace edits into another open tab', async ({ page, context }) => {
  await page.goto('/')
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.getByRole('combobox', { name: priorityName })).toBeVisible()
  await page.getByRole('combobox', { name: priorityName }).selectOption('low')
  await expect(page.getByText('Priority updated for Publish the launch readiness brief.')).toBeVisible()
  await expect(other.getByRole('combobox', { name: priorityName })).toHaveValue('low')
  await other.getByRole('combobox', { name: priorityName }).selectOption('high')
  await expect(other.getByText('Priority updated for Publish the launch readiness brief.')).toBeVisible()
  await expect(page.getByRole('combobox', { name: priorityName })).toHaveValue('high')
})

test('preserves corrupt storage and requires confirmation before resetting', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await page.evaluate((key) => { localStorage.setItem(key, '{broken') }, storageKey)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Workspace storage needs attention' })).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe('{broken')
  await expect(page.getByRole('button', { name: 'Reset local workspace' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Type RESET to replace local workspace data' }).fill('RESET')
  await page.getByRole('button', { name: 'Reset local workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
})

test('migrates supported v1 storage on startup without losing an edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: priorityName }).selectOption('low')
  await expect(page.getByText('Priority updated for Publish the launch readiness brief.')).toBeVisible()
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) throw new Error('Expected saved workspace')
    const saved = JSON.parse(raw) as { version: number; data: unknown }
    localStorage.setItem(key, JSON.stringify({ format: 'taskora.local', schemaVersion: 1, version: saved.version, data: saved.data }))
  }, storageKey)
  await page.reload()
  await expect(page.getByRole('combobox', { name: priorityName })).toHaveValue('low')
  await expect.poll(() => page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as { schemaVersion?: number }
    return saved.schemaVersion
  }, storageKey)).toBe(2)
})
