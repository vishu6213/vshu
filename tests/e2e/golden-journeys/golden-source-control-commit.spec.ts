import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { test } from '../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_CHANGED_PATH,
  GOLDEN_GIT_AUTHOR_EMAIL,
  GOLDEN_GIT_AUTHOR_NAME,
  installPassingNodePreCommitHook,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './golden-source-control'
import { waitForSessionReady } from '../desktop/renderer-probes/store'

test('@golden stages and commits a file through Source Control', async ({
  vshuPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'commit')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  seedGoldenSourceEdit(fixture.worktreePath)
  const hookMarkerPath = installPassingNodePreCommitHook(fixture)

  await waitForSessionReady(vshuPage)
  await openGoldenSourceControl(vshuPage, testRepoPath, fixture)

  const unstagedRow = vshuPage
    .locator('[data-testid="source-control-entry"][data-source-control-area="unstaged"]')
    .filter({ hasText: path.basename(GOLDEN_CHANGED_PATH) })
  await expect(unstagedRow).toBeVisible()
  const stageButton = unstagedRow.getByRole('button', { name: 'Stage' })
  await stageButton.focus()
  await stageButton.press('Enter')
  await expect(unstagedRow).toHaveCount(0, { timeout: 10_000 })

  const stagedRow = vshuPage
    .locator('[data-testid="source-control-entry"][data-source-control-area="staged"]')
    .filter({ hasText: path.basename(GOLDEN_CHANGED_PATH) })
  await expect(stagedRow).toBeVisible({ timeout: 10_000 })
  await vshuPage.getByRole('textbox', { name: 'Commit message' }).fill('test: golden daily loop')
  await vshuPage.getByRole('button', { name: 'Commit', exact: true }).click()

  await expect(stagedRow).toHaveCount(0, { timeout: 20_000 })
  await expect
    .poll(
      () =>
        execFileSync('git', ['status', '--porcelain'], {
          cwd: fixture.worktreePath,
          encoding: 'utf8'
        }),
      { timeout: 20_000, message: 'Golden commit worktree did not become clean' }
    )
    .toBe('')
  expect(
    execFileSync('git', ['show', '-s', '--format=%an%n%ae%n%s', 'HEAD'], {
      cwd: fixture.worktreePath,
      encoding: 'utf8'
    }).trim()
  ).toBe(`${GOLDEN_GIT_AUTHOR_NAME}\n${GOLDEN_GIT_AUTHOR_EMAIL}\ntest: golden daily loop`)
  await expect.poll(() => existsSync(hookMarkerPath), { timeout: 20_000 }).toBe(true)
  await expect(
    vshuPage.locator('[data-sonner-toast]').filter({ hasText: /node|command not found|cmd\.exe/i })
  ).toHaveCount(0)
})
