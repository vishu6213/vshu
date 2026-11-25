import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './markdown-editor-fixture'
import {
  collectRichMarkdownPageErrors,
  expectNoRichMarkdownSchemaCrash,
  INLINE_IMAGE_DETAILS_MARKDOWN,
  INLINE_IMAGE_FIXTURE_DIRECTORY,
  INLINE_IMAGE_PARAGRAPH_MARKDOWN,
  writeInlineImageAsset
} from './markdown-inline-image'
import { waitForActiveWorktree, waitForSessionReady } from '../../desktop/renderer-probes/store'

// Nested inline images used to parse invalid schema and fail only when the first edit reassembled their paragraph.
test.describe('Rich markdown inline image regression', () => {
  test.beforeEach(async ({ vshuPage }) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
  })

  test('an inline image inside a paragraph survives a keystroke', async ({
    vshuPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(vshuPage)
    const pageErrors = collectRichMarkdownPageErrors(vshuPage)
    let filePath: string | null = null

    try {
      writeInlineImageAsset(context.rootPath)
      filePath = await createMarkdownFixture(
        context,
        INLINE_IMAGE_FIXTURE_DIRECTORY,
        'paragraph-inline-image',
        testInfo.workerIndex,
        INLINE_IMAGE_PARAGRAPH_MARKDOWN
      )
      await openMarkdownFixture(vshuPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(vshuPage)

      const paragraph = editor.locator('p').filter({ hasText: 'more text' }).first()
      await expect(paragraph).toBeVisible({ timeout: 15_000 })
      await expect(editor.locator('img')).toHaveCount(1, { timeout: 15_000 })

      // Type at paragraph start to hit the reported reassembly RangeError.
      await paragraph.click({ position: { x: 12, y: 8 } })
      await vshuPage.keyboard.press('Home')
      await vshuPage.keyboard.type('X')

      await expect(editor.locator('p').filter({ hasText: 'XSome text' })).toHaveCount(1)
      await expect(editor.locator('img')).toHaveCount(1)
      await expectNoRichMarkdownSchemaCrash(vshuPage, pageErrors)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('an inline image inside a toggle summary survives a keystroke', async ({
    vshuPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(vshuPage)
    const pageErrors = collectRichMarkdownPageErrors(vshuPage)
    let filePath: string | null = null

    try {
      writeInlineImageAsset(context.rootPath)
      filePath = await createMarkdownFixture(
        context,
        INLINE_IMAGE_FIXTURE_DIRECTORY,
        'details-inline-image',
        testInfo.workerIndex,
        INLINE_IMAGE_DETAILS_MARKDOWN
      )
      await openMarkdownFixture(vshuPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(vshuPage)

      const summary = editor.locator('summary').first()
      await expect(summary).toBeVisible({ timeout: 15_000 })
      await expect(editor.locator('summary img')).toHaveCount(1, { timeout: 15_000 })

      await summary.click()
      await vshuPage.keyboard.press('End')
      await vshuPage.keyboard.type('X')

      await expect(editor.locator('summary').filter({ hasText: 'labelX' })).toHaveCount(1)
      await expect(editor.locator('summary img')).toHaveCount(1)
      await expectNoRichMarkdownSchemaCrash(vshuPage, pageErrors)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a formatting command over an inline image keeps the image', async ({
    vshuPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(vshuPage)
    const pageErrors = collectRichMarkdownPageErrors(vshuPage)
    let filePath: string | null = null

    try {
      writeInlineImageAsset(context.rootPath)
      filePath = await createMarkdownFixture(
        context,
        INLINE_IMAGE_FIXTURE_DIRECTORY,
        'paragraph-inline-image-bold',
        testInfo.workerIndex,
        INLINE_IMAGE_PARAGRAPH_MARKDOWN
      )
      await openMarkdownFixture(vshuPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(vshuPage)

      const paragraph = editor.locator('p').filter({ hasText: 'more text' }).first()
      await expect(paragraph).toBeVisible({ timeout: 15_000 })
      await expect(editor.locator('img')).toHaveCount(1, { timeout: 15_000 })

      // toggleBold reassembles every selected paragraph, which previously dropped the image.
      await paragraph.click({ position: { x: 12, y: 8 } })
      await vshuPage.keyboard.press('ControlOrMeta+a')
      await vshuPage.getByRole('button', { name: 'Bold', exact: true }).first().click()

      await expect(editor.locator('strong').first()).toBeVisible()
      await expect(editor.locator('img')).toHaveCount(1)
      await expectNoRichMarkdownSchemaCrash(vshuPage, pageErrors)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
