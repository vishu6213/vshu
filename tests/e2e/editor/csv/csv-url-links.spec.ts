import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'

test('dense CSVs below 1 MiB remain visible and shrinking a later row window recovers', async ({
  vshuPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  const name = 'dense-small.csv'
  const filePath = path.join(seededRepoPath, name)
  writeFileSync(filePath, `id\n${'\n'.repeat(600_000)}`)
  await vshuPage.evaluate(
    ({ name, filePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing dense CSV workspace')
      }
      state.openFile(
        {
          filePath,
          relativePath: name,
          worktreeId: state.activeWorktreeId,
          language: 'plaintext',
          mode: 'edit'
        },
        { preview: false }
      )
    },
    { name, filePath }
  )
  await expect(vshuPage.getByTestId('csv-grid')).toHaveAttribute('aria-rowcount', '600001')
  await vshuPage.getByRole('button', { name: 'Next rows' }).click()
  await expect(vshuPage.getByRole('rowheader', { name: '500001', exact: true })).toBeVisible()
  await vshuPage.getByTestId('csv-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(vshuPage.getByRole('rowheader', { name: '600000', exact: true })).toBeVisible()
  await vshuPage.evaluate(() => {
    const state = window.__store?.getState()
    const file = state?.openFiles.find((file) => file.filePath.endsWith('dense-small.csv'))
    if (!state || !file) {
      throw new Error('Missing dense CSV tab')
    }
    state.setEditorDraft(file.id, 'id\nfirst\nsecond\nthird\n')
  })
  await expect(vshuPage.getByTestId('csv-grid')).toHaveAttribute('aria-rowcount', '4')
  await expect(vshuPage.getByRole('gridcell', { name: 'first', exact: true })).toBeVisible()
  await expect(vshuPage.getByRole('gridcell', { name: 'third', exact: true })).toBeVisible()
  await expect(vshuPage.getByRole('button', { name: 'Next rows' })).toHaveCount(0)
  await vshuPage.screenshot({ path: testInfo.outputPath('dense-after-shrink.png') })
  if (
    process.env.VSHU_E2E_FORCE_HEADFUL !== '1' &&
    testInfo.project.metadata.vshuHeadful !== true
  ) {
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  }
})
