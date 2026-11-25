import { randomUUID } from 'node:crypto'
import type { Page } from '@stablyai/playwright-test'
import { test } from '../electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  getActiveTabId,
  getActiveWorktreeId,
  getWorktreeTabs,
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../renderer-probes/store'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWrites
} from '../../terminal/input/terminal-pty-write-spy'
import '../../terminal/input/terminal'
import { waitForActiveTerminalManager } from '../../terminal/layout/terminal-pane-operations'

function editablePasteChord(): string {
  return process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
}

async function getActiveTabTitle(page: Page, worktreeId: string): Promise<string> {
  const activeId = await getActiveTabId(page)
  expect(activeId).not.toBeNull()
  const tabs = await getWorktreeTabs(page, worktreeId)
  const tab = tabs.find((entry) => entry.id === activeId)
  expect(tab).toBeDefined()
  return tab!.title ?? ''
}

function tabLocatorByTitle(page: Page, title: string): ReturnType<Page['locator']> {
  const escaped = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return page.locator(`[data-testid="sortable-tab"][data-tab-title="${escaped}"]`).first()
}

test.describe('tab rename paste ownership', () => {
  test('keyboard paste into rename textbox does not also write to the active terminal', async ({
    electronApp,
    vshuPage
  }) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
    await ensureTerminalVisible(vshuPage)
    await waitForActiveTerminalManager(vshuPage, 30_000)
    await installTerminalPtyWriteSpy(electronApp)

    const worktreeId = (await getActiveWorktreeId(vshuPage))!
    const originalTitle = await getActiveTabTitle(vshuPage, worktreeId)
    const renameInput = vshuPage.getByRole('textbox', {
      name: `Rename tab ${originalTitle}`,
      exact: true
    })

    await tabLocatorByTitle(vshuPage, originalTitle).dblclick()
    await expect(renameInput).toBeVisible()
    await renameInput.fill('')

    const payload = `VSHU_E2E_TEXTBOX_PASTE_${randomUUID()}`
    await vshuPage.evaluate((text) => window.api.ui.writeClipboardText(text), payload)
    await clearTerminalPtyWriteLog(electronApp)
    await expect(renameInput).toBeFocused()

    await vshuPage.keyboard.press(editablePasteChord())

    await expect(renameInput).toHaveValue(payload)
    expect((await readTerminalPtyWrites(electronApp)).join('')).not.toContain(payload)

    await renameInput.press('Escape')
    await expect(tabLocatorByTitle(vshuPage, originalTitle)).toBeVisible()
  })
})
