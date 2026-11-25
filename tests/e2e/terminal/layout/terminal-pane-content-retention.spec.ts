// Require scrollback retention across tab, pane and worktree changes.

import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import '../input/terminal'
import { discoverActivePtyId } from '../input/terminal-active-pane'
import {
  execInTerminal,
  closeActiveTerminalPane,
  countVisibleTerminalPanes,
  focusLastTerminalPane,
  splitActiveTerminalPane,
  waitForTerminalOutput,
  waitForPaneCount
} from './terminal-pane-operations'
import { getTerminalContent } from './terminal-pane-identity'
import {
  getActiveWorktreeId,
  getActiveTabType,
  getWorktreeTabs,
  getAllWorktreeIds,
  switchToOtherWorktree,
  switchToWorktree,
  ensureTerminalVisible
} from '../../desktop/renderer-probes/store'
import { pressShortcut } from '../../desktop/renderer-probes/shortcuts'
import { registerTerminalPaneMountReadiness } from './terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('terminal pane retains content when switching tabs and back', async ({ vshuPage }) => {
    const ptyId = await discoverActivePtyId(vshuPage)
    const marker = `RETAIN_TEST_${Date.now()}`
    await execInTerminal(vshuPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(vshuPage, marker)

    const worktreeId = (await getActiveWorktreeId(vshuPage))!
    await pressShortcut(vshuPage, 't')

    await expect
      .poll(async () => (await getWorktreeTabs(vshuPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)

    const activeType = await getActiveTabType(vshuPage)
    expect(activeType).toBe('terminal')

    await pressShortcut(vshuPage, 'BracketLeft', { shift: true })

    await expect
      .poll(async () => (await getTerminalContent(vshuPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)

    await pressShortcut(vshuPage, 'BracketRight', { shift: true })
    await pressShortcut(vshuPage, 'w')
  })

  test('terminal pane retains content when splitting and closing a pane', async ({ vshuPage }) => {
    const ptyId = await discoverActivePtyId(vshuPage)
    const marker = `SPLIT_RETAIN_${Date.now()}`
    await execInTerminal(vshuPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(vshuPage, marker)

    const panesBefore = await countVisibleTerminalPanes(vshuPage)

    await splitActiveTerminalPane(vshuPage, 'vertical')
    await waitForPaneCount(vshuPage, panesBefore + 1)

    await focusLastTerminalPane(vshuPage)
    await closeActiveTerminalPane(vshuPage)
    await waitForPaneCount(vshuPage, panesBefore)

    await expect
      .poll(async () => (await getTerminalContent(vshuPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)
  })

  test('terminal pane retains content when switching worktrees and back', async ({ vshuPage }) => {
    const allWorktreeIds = await getAllWorktreeIds(vshuPage)
    if (allWorktreeIds.length < 2) {
      test.skip(true, 'Need at least 2 worktrees to test worktree switching')
      return
    }

    const worktreeId = (await getActiveWorktreeId(vshuPage))!

    const ptyId = await discoverActivePtyId(vshuPage)
    const marker = `WT_RETAIN_${Date.now()}`
    await execInTerminal(vshuPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(vshuPage, marker)

    const otherId = await switchToOtherWorktree(vshuPage, worktreeId)
    expect(otherId).not.toBeNull()
    await expect.poll(async () => getActiveWorktreeId(vshuPage), { timeout: 5_000 }).toBe(otherId)

    await switchToWorktree(vshuPage, worktreeId)
    await expect
      .poll(async () => getActiveWorktreeId(vshuPage), { timeout: 5_000 })
      .toBe(worktreeId)

    // Poll the retained marker after worktree return: serialize-addon rebind can lag the activation cascade, so avoid an earlier manager-timing assertion.
    await ensureTerminalVisible(vshuPage)

    await expect
      .poll(async () => (await getTerminalContent(vshuPage)).includes(marker), { timeout: 20_000 })
      .toBe(true)
  })
})
