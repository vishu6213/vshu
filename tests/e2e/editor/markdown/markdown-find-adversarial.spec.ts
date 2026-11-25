import type { Locator, Page } from '@stablyai/playwright-test'
import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import { pressShortcut } from '../../desktop/renderer-probes/shortcuts'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './markdown-editor-fixture'

const FIRST = 'First alpha paragraph for pointer selection.'
const SECOND = 'Second beta paragraph for pointer selection.'
const SOURCE = [
  '# Adversarial Find interactions',
  'Needle first match.',
  ...Array.from({ length: 65 }, (_, index) => `Spacer ${index} keeps the search match away.`),
  FIRST,
  SECOND,
  '| Left | Right |\n| --- | --- |\n| Cell alpha | Cell beta |\n| Cell gamma | Cell delta |',
  '- [ ] Task marker',
  '<details open>\n<summary>Details marker</summary>\n\nDetails body marker\n\n</details>',
  '```javascript\nconst codeMarker = "clean";\n```',
  'Late target paragraph for a pending query.',
  ...Array.from({ length: 30 }, (_, index) => `Tail spacer ${index} keeps the second match away.`),
  'Needle final match.'
].join('\n\n')

async function textPoint(target: Locator, offset: number) {
  return target.evaluate((element, offset) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let remaining = offset
    let node = walker.nextNode()
    while (node) {
      if (node instanceof Text && remaining <= node.length) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.collapse(true)
        const bounds = range.getBoundingClientRect()
        return { x: bounds.left, y: bounds.top + bounds.height / 2 }
      }
      remaining -= node.textContent?.length ?? 0
      node = walker.nextNode()
    }
    throw new Error('Text offset was not found')
  }, offset)
}

async function selectedText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? '')
}

async function centered(target: Locator) {
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }))
}

async function find(page: Page, query = 'Needle', status = '1/2') {
  await pressShortcut(page, 'f')
  const input = page.getByRole('textbox', { name: 'Find in rich markdown editor' })
  await expect(input).toBeFocused()
  await input.fill(query)
  await expect(page.locator('.rich-markdown-search-status')).toHaveText(status)
  return input
}

/** Clicks, then waits for the selectionchange the editor reads the click's selection from; Xvfb delivers it late. */

async function drag(page: Page, start: Locator, end: Locator, from: number, to: number) {
  const firstPoint = await textPoint(start, from)
  const lastPoint = await textPoint(end, to)
  await page.mouse.move(firstPoint.x, firstPoint.y)
  await page.mouse.down()
  await page.mouse.move(lastPoint.x, lastPoint.y, { steps: 15 })
  await page.mouse.up()
}

test.beforeEach(async ({ vshuPage, registerPostElectronShutdownCleanup }, testInfo) => {
  const context = await getActiveWorktreeContext(vshuPage)
  const filePath = await createMarkdownFixture(
    context,
    '.vshu-e2e-markdown-adversarial',
    'find-interactions',
    testInfo.workerIndex,
    SOURCE
  )
  registerPostElectronShutdownCleanup(() => cleanupMarkdownFixture(filePath))
  await openMarkdownFixture(vshuPage, context, filePath)
  const editor = await waitForRichMarkdownEditor(vshuPage)
  await editor.locator('p').first().click()
})

test('Replace input returns to a multi-paragraph drag and explicit next-match navigation', async ({
  vshuPage
}, testInfo) => {
  const editor = vshuPage.locator('.rich-markdown-editor')
  const search = await find(vshuPage)
  await vshuPage.getByRole('button', { name: 'Toggle replace', exact: true }).click()
  const replace = vshuPage.getByRole('textbox', { name: 'Replace in rich markdown editor' })
  await replace.fill('Thread')
  const first = editor.getByText(FIRST, { exact: true })
  const second = editor.getByText(SECOND, { exact: true })
  await centered(first)
  await drag(vshuPage, first, second, 6, 11)
  expect(await selectedText(vshuPage)).toBe(`${FIRST.slice(6)}\n\n${SECOND.slice(0, 11)}`)
  await vshuPage.keyboard.type('xy', { delay: 100 })
  await expect(
    editor.getByText(`${FIRST.slice(0, 6)}xy${SECOND.slice(11)}`, { exact: true })
  ).toBeVisible()
  await vshuPage.getByRole('button', { name: 'Next match', exact: true }).click()
  await expect.poll(() => selectedText(vshuPage)).toBe('Needle')
  await expect(vshuPage.locator('.rich-markdown-search-status')).toHaveText('2/2')
  await replace.focus()
  await vshuPage.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(editor.getByText('Thread final match.', { exact: true })).toBeVisible()
  await expect(vshuPage.locator('.rich-markdown-search-status')).toHaveText('1/1')
  await expect(replace).toBeFocused()
  await vshuPage.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
  await pressShortcut(vshuPage, 'f')
  await expect(search).toBeFocused()
  await expect(search).toHaveValue('')
  await vshuPage.screenshot({ path: testInfo.outputPath('replace-next-reopen.png') })
})

test('Find preserves embedded task, details, and code editing', async ({ vshuPage }, testInfo) => {
  const editor = vshuPage.locator('.rich-markdown-editor')
  const search = await find(vshuPage)
  await centered(editor.getByRole('checkbox'))
  await search.focus()
  const checkbox = editor.getByRole('checkbox')
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await expect(search).toHaveValue('Needle')
  await search.focus()
  const details = editor.locator('[data-type="details"]')
  await details.getByRole('button').click()
  await expect(details.locator('[data-type="detailsContent"]')).toBeHidden()
  await search.focus()
  await details.getByRole('button').click()
  await expect(details.locator('[data-type="detailsContent"]')).toBeVisible()
  const body = editor.getByText('Details body marker', { exact: true })
  const bodyPoint = await textPoint(body, 7)
  await search.focus()
  await vshuPage.mouse.click(bodyPoint.x, bodyPoint.y)
  await vshuPage.keyboard.type('xy', { delay: 100 })
  await expect(editor.getByText('Detailsxy body marker', { exact: true })).toBeVisible()
  const code = editor.getByText('const codeMarker = "clean";', { exact: true })
  await centered(code)
  const codePoint = await textPoint(code, 6)
  await search.focus()
  await vshuPage.mouse.click(codePoint.x, codePoint.y)
  await vshuPage.keyboard.type('xy', { delay: 100 })
  await expect(editor.getByText('const xycodeMarker = "clean";', { exact: true })).toBeVisible()
  await expect(vshuPage.locator('.rich-markdown-search-status')).toHaveText('1/2')
  await vshuPage.screenshot({ path: testInfo.outputPath('embedded-control-editing.png') })
})

test('a pending Find query cannot claim focus after document and checkbox interaction', async ({
  vshuPage
}, testInfo) => {
  const editor = vshuPage.locator('.rich-markdown-editor')
  const search = await find(vshuPage)
  const target = editor.getByText('Late target paragraph for a pending query.', { exact: true })
  await centered(target)
  const point = await textPoint(target, 5)
  const viewport = vshuPage.locator('.rich-markdown-editor-shell .overflow-auto')
  const scroll = await viewport.evaluate((element) => element.scrollTop)
  const checkbox = editor.getByRole('checkbox')
  const checkboxPoint = await checkbox.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  })
  await search.fill('Cell alpha')
  await vshuPage.mouse.click(point.x, point.y)
  await expect(editor).toBeFocused()
  await vshuPage.mouse.click(checkboxPoint.x, checkboxPoint.y)
  await expect(checkbox).toBeChecked()
  await expect(vshuPage.locator('.rich-markdown-search-status')).toHaveText('1/1')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0)
  await expect(target).toHaveText('Late target paragraph for a pending query.')
  await vshuPage.mouse.click(point.x, point.y)
  await vshuPage.keyboard.type('xy', { delay: 100 })
  await expect(
    editor.getByText('Late xytarget paragraph for a pending query.', { exact: true })
  ).toBeVisible()
  await expect(vshuPage.locator('.rich-markdown-search-status')).toHaveText('1/1')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0)
  await expect(search).toHaveValue('Cell alpha')
  await vshuPage.screenshot({ path: testInfo.outputPath('pending-query-editor-caret.png') })
})

test('Replace advances when its replacement still contains the search query', async ({
  vshuPage
}, testInfo) => {
  const editor = vshuPage.locator('.rich-markdown-editor')
  await find(vshuPage)
  await vshuPage.getByRole('button', { name: 'Toggle replace', exact: true }).click()
  await vshuPage.getByRole('textbox', { name: 'Replace in rich markdown editor' }).fill('NeedleX')
  await vshuPage.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(editor.getByText('NeedleX first match.', { exact: true })).toBeVisible()
  await expect(vshuPage.locator('.rich-markdown-search-status')).toHaveText('2/2')
  await expect(
    editor.getByText('Needle final match.', { exact: true }).locator('[data-active="true"]')
  ).toHaveText('Needle')
  await vshuPage.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(editor.getByText('NeedleX final match.', { exact: true })).toBeVisible()
  await expect(editor.getByText('NeedleX first match.', { exact: true })).toBeVisible()
  await expect(vshuPage.locator('.rich-markdown-search-status')).toHaveText('1/2')
  await vshuPage.screenshot({ path: testInfo.outputPath('replacement-retains-query.png') })
})
