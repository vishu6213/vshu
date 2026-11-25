import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import { createPdfFindFixture } from './pdf-find-fixture'
import { pressShortcut } from '../../desktop/renderer-probes/shortcuts'

test.describe('PDF in a folder workspace', () => {
  test.use({ seedTestRepo: false })

  test('finds and navigates a PDF without a Git repository', async ({
    vshuPage,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    const folderPath = mkdtempSync(path.join(os.tmpdir(), 'vshu-pdf-folder-'))
    const filePath = path.join(folderPath, 'pdf-find-fixture.pdf')
    writeFileSync(filePath, createPdfFindFixture())
    registerPostElectronShutdownCleanup(async () =>
      rmSync(folderPath, { recursive: true, force: true })
    )
    await vshuPage.evaluate(
      async ({ folderPath, filePath }) => {
        const state = window.__store?.getState()
        if (!state) {
          throw new Error('Missing fixture store')
        }
        const group = await window.api.projectGroups.create({
          name: 'PDF fixture',
          parentPath: folderPath,
          createdFrom: 'folder-scan'
        })
        await state.fetchProjectGroups({ runtimeEnvironmentId: null, throwOnError: true })
        const folder = await state.createFolderWorkspace(
          {
            projectGroupId: group.id,
            name: 'PDF documents',
            folderPath
          },
          { runtimeEnvironmentId: null }
        )
        if (!folder) {
          throw new Error('Missing fixture folder')
        }
        const worktreeId = `folder:${folder.folderWorkspace.id}`
        state.setActiveWorktree(worktreeId)
        state.openFile({
          filePath,
          relativePath: 'pdf-find-fixture.pdf',
          worktreeId,
          language: 'plaintext',
          mode: 'edit'
        })
      },
      { folderPath, filePath }
    )
    await expect(vshuPage.locator('.pdfViewer .page')).toHaveCount(3)
    await expect(vshuPage.locator('.pdfViewer .page').first().locator('.textLayer')).toContainText(
      'needle result 1'
    )
    await pressShortcut(vshuPage, 'f')
    const input = vshuPage.getByPlaceholder('Find in page...')
    await input.fill('needle')
    await expect(input.locator('..')).toContainText('1 of 6')
    const selected = vshuPage.locator('.pdfViewer .highlight.selected').locator('..')
    await expect(selected).toHaveText('needle result 1')
    await input.press('Enter')
    await expect(input.locator('..')).toContainText('2 of 6')
    await expect(selected).toHaveText('needle result 2')
    await vshuPage.screenshot({ path: testInfo.outputPath('folder-next.png') })
  })
})
