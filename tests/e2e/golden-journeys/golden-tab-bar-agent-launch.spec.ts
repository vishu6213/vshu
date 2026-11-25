import type { Page } from '@stablyai/playwright-test'
import { test } from '../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_READY_MARKER,
  launchGoldenStubAgentFromNewTab
} from './golden-stub-agent'
import {
  getFirstWslDistro,
  removeWslGoldenStubAgent,
  stageWslGoldenStubAgent,
  useWslRuntimeForActiveProject
} from '../remote/wsl-hosts/wsl-golden-stub-agent'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../desktop/renderer-probes/store'
import '../terminal/input/terminal'
import { getTerminalContent } from '../terminal/layout/terminal-pane-identity'
import type { BuiltInWindowsTerminalShell } from '../../../src/shared/shell/launch/windows-terminal-shell'

// Covers the Windows-only tab-bar launch path that the default-shell test misses.

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

const WINDOWS_SHELLS: readonly BuiltInWindowsTerminalShell[] = [
  'powershell.exe',
  'cmd.exe',
  'git-bash'
]

async function openWorkspaceTerminal(page: Page): Promise<void> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
}

// Suite-level skipping avoids launching Electron for each unsupported case.
test.describe('Windows runtimes', () => {
  test.skip(process.platform !== 'win32', 'Windows agent launch matrix is Windows-only')

  for (const shell of WINDOWS_SHELLS) {
    test(`tab-bar + menu launches an agent under ${shell} @tab-bar-agent-launch-golden`, async ({
      vshuPage
    }) => {
      await openWorkspaceTerminal(vshuPage)
      // Each shell family requires different launch-command quoting.
      await configureGoldenStubAgent(vshuPage, { agent: 'codex', windowsShell: shell })
      await launchGoldenStubAgentFromNewTab(vshuPage)

      expect(await getTerminalContent(vshuPage)).toContain(GOLDEN_STUB_READY_MARKER)
    })
  }

  test('tab-bar + menu launches an agent inside WSL @tab-bar-agent-launch-golden', async ({
    vshuPage
  }) => {
    await openWorkspaceTerminal(vshuPage)

    const distro = await getFirstWslDistro(vshuPage)
    test.skip(!distro, 'No WSL distro is available on this Windows host')
    const stage = stageWslGoldenStubAgent(distro!)
    test.skip(!stage, 'WSL distro would not accept the staged stub agent')

    try {
      // WSL must retarget both agent detection and the PTY.
      await useWslRuntimeForActiveProject(vshuPage, distro!)
      await configureGoldenStubAgent(vshuPage, { agent: 'codex' })
      await launchGoldenStubAgentFromNewTab(vshuPage)

      // The distro-only marker proves the agent ran in WSL.
      expect(await getTerminalContent(vshuPage)).toContain(GOLDEN_STUB_READY_MARKER)
    } finally {
      removeWslGoldenStubAgent(distro!, stage!)
    }
  })
})
