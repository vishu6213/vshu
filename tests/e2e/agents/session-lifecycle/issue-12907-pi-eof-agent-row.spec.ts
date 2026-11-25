import { test } from '../../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../../desktop/renderer-probes/store'
import { waitForActivePanePtyId } from '../../terminal/input/terminal'
import {
  sendToTerminal,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from '../../terminal/layout/terminal-pane-operations'
import {
  stageNodeScriptForTerminal,
  type StagedTerminalNodeScript
} from '../../terminal/input/run-node-script-in-terminal'
import { worktreeRow } from '../../workspaces/sidebar/worktree-row-locators'

test('Pi EOF removes the completed agent row from the live Electron sidebar (#12907)', async ({
  vshuPage
}, testInfo) => {
  await waitForSessionReady(vshuPage)
  const worktreeId = await waitForActiveWorktree(vshuPage)
  await ensureTerminalVisible(vshuPage)
  await waitForActiveTerminalManager(vshuPage)
  const ptyId = await waitForActivePanePtyId(vshuPage)
  await vshuPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('window.__store is unavailable')
    }
    state.setAgentActivityDisplayMode('full')
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
  })

  const script: StagedTerminalNodeScript = stageNodeScriptForTerminal(
    "process.stdout.write('PI_EOF_AGENT_READY\\r\\n\\x1b]0;Pi\\x07'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"
  )
  // Exit the POSIX shell after Node accepts EOF so the surviving shell cannot hide agent cleanup.
  await sendToTerminal(vshuPage, ptyId, `${script.command}; exit\r`)
  try {
    await waitForTerminalOutput(vshuPage, 'PI_EOF_AGENT_READY', 15_000)
    const agentRows = worktreeRow(vshuPage, worktreeId).locator('[aria-label="Agents"] > div')
    await expect(agentRows).toHaveCount(1)
    await vshuPage.screenshot({ path: testInfo.outputPath('pi-row-before-eof.png') })

    await sendToTerminal(vshuPage, ptyId, '\u0004')
    await expect(agentRows).toHaveCount(0, { timeout: 15_000 })
    await vshuPage.screenshot({ path: testInfo.outputPath('pi-row-after-eof.png') })
  } finally {
    script.cleanup()
  }
})
