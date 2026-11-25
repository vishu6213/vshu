import { readFileSync } from 'node:fs'
import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  cleanupMarkdownFixture,
  closeActiveEditorTab,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './markdown-editor-fixture'
import {
  expectEditableNestedToggles,
  expectFileKeepsNesting,
  expectSentinelInsideNestedToggle,
  NESTED_TOGGLE_FIXTURE_DIRECTORY,
  NESTED_TOGGLE_MARKDOWN,
  placeCaretInNestedToggleBody
} from './markdown-nested-toggle'
import { waitForActiveWorktree, waitForSessionReady } from '../../desktop/renderer-probes/store'

test.describe('Markdown nested toggle regression', () => {
  test.beforeEach(async ({ vshuPage }) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
  })

  test('editing a nested toggle survives save and reopen', async ({ vshuPage }, testInfo) => {
    const context = await getActiveWorktreeContext(vshuPage)
    const sentinel = `editedInsideNestedToggle${Date.now()}`
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-edit',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(vshuPage, context, filePath)
      await waitForRichMarkdownEditor(vshuPage)
      await expectEditableNestedToggles(vshuPage)

      await placeCaretInNestedToggleBody(vshuPage)
      await vshuPage.keyboard.type(` ${sentinel}`)
      await expectSentinelInsideNestedToggle(vshuPage, sentinel)

      // Save through the real shortcut and assert the bytes that landed on disk.
      await vshuPage.keyboard.press('ControlOrMeta+S')
      const savedPath = filePath
      await expect
        .poll(() => readFileSync(savedPath, 'utf8'), { timeout: 10_000 })
        .toContain(sentinel)
      expectFileKeepsNesting(readFileSync(savedPath, 'utf8'), sentinel)

      // Reopen the saved bytes from scratch; the reported bug appeared only after reparsing.
      await closeActiveEditorTab(vshuPage, savedPath)
      await openMarkdownFixture(vshuPage, context, savedPath)
      await waitForRichMarkdownEditor(vshuPage)
      await expectEditableNestedToggles(vshuPage)
      await expectSentinelInsideNestedToggle(vshuPage, sentinel)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
