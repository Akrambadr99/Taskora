import { expect, test } from '@playwright/test'

test('explains blocked completion on the board and in issue details', async ({ page }) => {
  await page.goto('/board')
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Launch readiness' })

  const dependent = page.getByRole('combobox', { name: 'Move Complete launch risk review' })
  const backlogId = await dependent.locator('option', { hasText: 'Backlog' }).getAttribute('value')
  if (!backlogId) throw new Error('Expected backlog stage.')
  await dependent.selectOption({ label: 'Done' })
  await expect(page.getByRole('alert')).toContainText('Complete OPS-1')
  await expect(dependent).toHaveValue(backlogId)

  await page.getByRole('link', { name: 'Complete launch risk review' }).click()
  await page.getByRole('button', { name: 'Edit issue' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit issue' })
  await dialog.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Done' })
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Complete OPS-1')
  await expect(dialog).toBeVisible()
})
