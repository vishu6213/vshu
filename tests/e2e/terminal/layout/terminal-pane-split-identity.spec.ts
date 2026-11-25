// Require stable split-leaf UUIDs across PTY binding, VSHU_PANE_KEY and context menu.

import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import { UUID_RE, waitForPaneIdentitySnapshot } from '../input/terminal'
import { discoverActivePtyId } from '../input/terminal-active-pane'
import { execInTerminal, waitForTerminalOutput } from './terminal-pane-operations'
import './terminal-pane-title-actions'

import { registerTerminalPaneMountReadiness } from './terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('terminal process receives VSHU_PANE_KEY with the active UUID leaf id', async ({
    vshuPage
  }) => {
    const snapshot = await waitForPaneIdentitySnapshot(vshuPage, 1)
    const activeLeafId = snapshot.activeLeafId ?? snapshot.panes[0]?.leafId
    if (!activeLeafId) {
      throw new Error('No active pane leaf id found')
    }

    const expectedPaneKey = `${snapshot.tabId}:${activeLeafId}`
    const ptyId = await discoverActivePtyId(vshuPage)
    const marker = `VSHU_PANE_KEY_E2E_${Date.now()}`

    await execInTerminal(vshuPage, ptyId, `printf '${marker}=%s\\n' "$VSHU_PANE_KEY"`)
    await waitForTerminalOutput(vshuPage, `${marker}=${expectedPaneKey}`)

    expect(activeLeafId).toMatch(UUID_RE)
  })
})
