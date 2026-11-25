import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { test } from '../../desktop/electron-fixtures/vshu-app'
import { type Page, expect } from '@stablyai/playwright-test'
import { focusActiveTerminalInput, waitForActivePanePtyId } from './terminal'
import {
  sendToTerminal,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from '../layout/terminal-pane-operations'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../../desktop/renderer-probes/store'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWrites
} from './terminal-pty-write-spy'

function keyboardPasteChords(): string[] {
  return process.platform === 'darwin'
    ? ['Meta+V']
    : ['Control+V', 'Control+Shift+V', 'Shift+Insert']
}

function pasteEchoScript(runId: string, options?: { mouseTracking?: boolean }): string {
  const mouseTracking = options?.mouseTracking === true
  return `
process.stdin.setEncoding('utf8')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
let seq = 0
const interrupt = String.fromCharCode(3)
const esc = String.fromCharCode(27)
if (${mouseTracking}) process.stdout.write(esc + '[?1000h' + esc + '[?1006h')
process.stdout.write('PASTE_READY_${runId}\\n')
process.stdin.on('data', (chunk) => {
  if (chunk.includes(interrupt)) {
    if (${mouseTracking}) process.stdout.write(esc + '[?1006l' + esc + '[?1000l')
    process.exit(0)
  }
  seq += 1
  const encoded = Buffer.from(chunk, 'utf8').toString('base64')
  process.stdout.write('PASTE_CHUNK_${runId}_' + seq + ':' + encoded + '\\n')
})
`
}

function countOccurrences(value: string, needle: string): number {
  let count = 0
  let index = value.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = value.indexOf(needle, index + needle.length)
  }
  return count
}

async function rightClickActiveTerminalSurface(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const surface =
      pane?.container.querySelector<HTMLElement>('.xterm-screen') ??
      pane?.container.querySelector<HTMLElement>('.xterm') ??
      pane?.container
    if (!pane || !surface) {
      throw new Error('No active terminal surface to right-click')
    }
    pane.terminal.clearSelection()
    const rect = surface.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('Active terminal surface is not measurable')
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
  })
  await page.mouse.click(point.x, point.y, { button: 'right' })
}

async function openTerminalContextMenu(page: Page): Promise<void> {
  const isWindows = await page.evaluate(() => navigator.userAgent.includes('Windows'))
  const isMac = await page.evaluate(() => navigator.userAgent.includes('Mac'))
  const modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = isMac || isWindows ? ['Control'] : []
  await page
    .locator('.xterm:visible')
    .first()
    .click({
      button: isMac ? 'left' : 'right',
      position: { x: 40, y: 40 },
      modifiers
    })
  await expect(page.getByRole('menuitem', { name: /Paste/ })).toBeVisible()
}

test.describe('terminal paste ownership', () => {
  test('keyboard paste shortcuts send clipboard text to the focused terminal exactly once', async ({
    electronApp,
    vshuPage,
    testRepoPath
  }) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
    await ensureTerminalVisible(vshuPage)
    await waitForActiveTerminalManager(vshuPage, 30_000)
    await installTerminalPtyWriteSpy(electronApp)

    const ptyId = await waitForActivePanePtyId(vshuPage)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.vshu-paste-ownership-${runId}.mjs`)
    writeFileSync(scriptPath, pasteEchoScript(runId))
    let scriptStarted = false

    try {
      await sendToTerminal(vshuPage, ptyId, `node ${JSON.stringify(scriptPath)}\r`)
      scriptStarted = true
      await waitForTerminalOutput(vshuPage, `PASTE_READY_${runId}`, 10_000)

      for (const [index, chord] of keyboardPasteChords().entries()) {
        const payload = `VSHU_E2E_PASTE_${runId}_${index}`
        const encodedPayload = Buffer.from(payload, 'utf8').toString('base64')
        await clearTerminalPtyWriteLog(electronApp)
        await vshuPage.evaluate((text) => window.api.ui.writeClipboardText(text), payload)
        await focusActiveTerminalInput(vshuPage)

        await vshuPage.keyboard.press(chord)
        await waitForTerminalOutput(vshuPage, encodedPayload, 10_000, 12_000)

        const writes = (await readTerminalPtyWrites(electronApp)).join('')
        expect(countOccurrences(writes, payload), `${chord} PTY write count`).toBe(1)
      }
    } finally {
      if (scriptStarted) {
        await sendToTerminal(vshuPage, ptyId, '\x03').catch(() => undefined)
      }
      rmSync(scriptPath, { force: true })
    }
  })

  test('terminal context-menu Paste sends clipboard text exactly once', async ({
    electronApp,
    vshuPage,
    testRepoPath
  }) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
    await ensureTerminalVisible(vshuPage)
    await waitForActiveTerminalManager(vshuPage, 30_000)
    await installTerminalPtyWriteSpy(electronApp)

    const ptyId = await waitForActivePanePtyId(vshuPage)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.vshu-paste-context-menu-${runId}.mjs`)
    writeFileSync(scriptPath, pasteEchoScript(runId))
    let scriptStarted = false

    try {
      await sendToTerminal(vshuPage, ptyId, `node ${JSON.stringify(scriptPath)}\r`)
      scriptStarted = true
      await waitForTerminalOutput(vshuPage, `PASTE_READY_${runId}`, 10_000)

      const payload = `VSHU_E2E_CONTEXT_MENU_PASTE_${runId}`
      const encodedPayload = Buffer.from(payload, 'utf8').toString('base64')
      await clearTerminalPtyWriteLog(electronApp)
      await vshuPage.evaluate((text) => window.api.ui.writeClipboardText(text), payload)
      await focusActiveTerminalInput(vshuPage)

      await openTerminalContextMenu(vshuPage)
      await vshuPage.getByRole('menuitem', { name: /Paste/ }).click()
      await waitForTerminalOutput(vshuPage, encodedPayload, 10_000, 12_000)

      const writes = (await readTerminalPtyWrites(electronApp)).join('')
      expect(countOccurrences(writes, payload), 'terminal context-menu PTY write count').toBe(1)
    } finally {
      if (scriptStarted) {
        await sendToTerminal(vshuPage, ptyId, '\x03').catch(() => undefined)
      }
      rmSync(scriptPath, { force: true })
    }
  })

  test('right-click paste into a mouse-tracking terminal app sends the clipboard once and no right-button report', async ({
    electronApp,
    vshuPage,
    testRepoPath
  }) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
    await ensureTerminalVisible(vshuPage)
    await waitForActiveTerminalManager(vshuPage, 30_000)
    await installTerminalPtyWriteSpy(electronApp)

    const ptyId = await waitForActivePanePtyId(vshuPage)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.vshu-paste-right-click-${runId}.mjs`)
    writeFileSync(scriptPath, pasteEchoScript(runId, { mouseTracking: true }))
    let scriptStarted = false

    try {
      await sendToTerminal(vshuPage, ptyId, `node ${JSON.stringify(scriptPath)}\r`)
      scriptStarted = true
      await waitForTerminalOutput(vshuPage, `PASTE_READY_${runId}`, 10_000)
      await vshuPage.evaluate(() =>
        window.__store?.getState().updateSettings({ terminalRightClickToPaste: true })
      )
      await expect
        .poll(() =>
          vshuPage.evaluate(() => window.__store?.getState().settings?.terminalRightClickToPaste)
        )
        .toBe(true)

      const payload = `VSHU_E2E_RIGHT_CLICK_PASTE_${runId}`
      const encodedPayload = Buffer.from(payload, 'utf8').toString('base64')
      await clearTerminalPtyWriteLog(electronApp)
      await vshuPage.evaluate((text) => window.api.ui.writeClipboardText(text), payload)
      await focusActiveTerminalInput(vshuPage)

      await rightClickActiveTerminalSurface(vshuPage)
      await waitForTerminalOutput(vshuPage, encodedPayload, 10_000, 12_000)

      const writes = (await readTerminalPtyWrites(electronApp)).join('')
      expect(countOccurrences(writes, payload), 'right-click PTY write count').toBe(1)
      // Why: a TUI that pastes on its own right-button report would paste again (#25192).
      expect(writes, 'right-button mouse report').not.toContain('\x1b[<2;')
    } finally {
      if (scriptStarted) {
        await sendToTerminal(vshuPage, ptyId, '\x03').catch(() => undefined)
      }
      rmSync(scriptPath, { force: true })
    }
  })
})
