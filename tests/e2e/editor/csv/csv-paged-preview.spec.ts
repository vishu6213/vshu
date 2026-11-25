import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'

test.use({
  vshuAppExtraArgs: [
    '--enable-precise-memory-info',
    ...(process.env.VSHU_CSV_CDP_PORT
      ? [`--remote-debugging-port=${process.env.VSHU_CSV_CDP_PORT}`]
      : [])
  ]
})

test('paged previews accept a maximum-size record with a BOM and CRLF', async ({
  vshuPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  const name = 'record-boundary.csv'
  const filePath = path.join(seededRepoPath, name)
  const recordBytes = 1024 * 1024
  writeFileSync(filePath, `\ufeff${'x'.repeat(recordBytes)}\r\ntail\r\n`)
  await vshuPage.evaluate(
    ({ name, filePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing CSV boundary workspace')
      }
      state.openFile({
        filePath,
        relativePath: name,
        worktreeId: state.activeWorktreeId,
        language: 'plaintext',
        mode: 'edit'
      })
    },
    { name, filePath }
  )
  await expect(vshuPage.getByRole('table')).toHaveAttribute('aria-rowcount', '2', {
    timeout: 30_000
  })
  await expect(vshuPage.getByRole('cell', { name: 'tail', exact: true })).toBeVisible()
  expect(
    await vshuPage
      .getByRole('columnheader')
      .nth(1)
      .evaluate((element) => element.textContent?.length)
  ).toBe(recordBytes)
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
