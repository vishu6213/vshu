import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from './source-control-generation-app'
import { type TestInfo, expect } from '@stablyai/playwright-test'
import { waitForActiveWorktree, waitForSessionReady } from '../desktop/renderer-probes/store'
import {
  createBranchCommit,
  openChecks,
  seedCreatePrComposer
} from './source-control-ai-generation'
import { installDelayedPrGenerator } from './source-control-ai-generators'

function readLog(pathname: string): string {
  try {
    return readFileSync(pathname, 'utf8')
  } catch {
    return ''
  }
}

async function writeEvidence(
  testInfo: TestInfo,
  screenshotDir: string,
  filename: string,
  evidence: unknown
): Promise<void> {
  const evidencePath = path.join(screenshotDir, filename)
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  await testInfo.attach(filename, {
    path: evidencePath,
    contentType: 'application/json'
  })
}

test.describe('Source Control AI PR generation worktree switching', () => {
  test.describe.configure({ mode: 'serial' })

  test('keeps checks-panel PR generation running after switching worktrees', async ({
    vshuPage
  }, testInfo) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
    const { primaryWorktreeId, prWorktreeId, prWorktreePath, primaryBranch } =
      await seedCreatePrComposer(vshuPage)
    createBranchCommit(prWorktreePath)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `checks-pr-generation-switch-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })
    const generatorScriptPath = path.join(screenshotDir, 'delayed-checks-pr-generator.cjs')
    const callLogPath = path.join(screenshotDir, 'delayed-checks-pr-generator.log')
    await installDelayedPrGenerator(vshuPage, generatorScriptPath, callLogPath, primaryBranch)

    await openChecks(vshuPage, prWorktreeId)
    const generate = vshuPage.getByRole('button', {
      name: 'Generate pull request details with AI'
    })
    await expect(generate).toBeVisible({ timeout: 10_000 })
    await expect(generate).toBeEnabled()
    await generate.click()
    await expect(
      vshuPage.getByRole('button', { name: 'Stop generating pull request details' })
    ).toBeVisible()
    await expect.poll(() => readLog(callLogPath)).toContain('start')
    await vshuPage.screenshot({
      path: path.join(screenshotDir, '01-checks-pr-generation-pending-on-a.png')
    })

    await openChecks(vshuPage, primaryWorktreeId)
    await expect(vshuPage.getByText('Generated PR title after switch')).toHaveCount(0)
    await vshuPage.screenshot({
      path: path.join(screenshotDir, '02-checks-switched-to-b-no-generated-fields.png')
    })

    await expect.poll(() => readLog(callLogPath), { timeout: 10_000 }).toContain('finish')
    await openChecks(vshuPage, prWorktreeId)
    await expect(vshuPage.getByRole('textbox', { name: 'Pull request title' })).toHaveValue(
      'Generated PR title after switch',
      { timeout: 10_000 }
    )
    await expect(vshuPage.getByRole('textbox', { name: 'Pull request description' })).toHaveValue(
      'Generated PR body after switch'
    )
    await vshuPage.screenshot({
      path: path.join(screenshotDir, '03-checks-returned-to-a-generated-fields.png')
    })
    await writeEvidence(testInfo, screenshotDir, 'checks-pr-generation-switch-evidence.json', {
      expectedOriginalWorktreeId: prWorktreeId,
      expectedOtherWorktreeId: primaryWorktreeId,
      generatorLog: readLog(callLogPath)
    })
  })
})
