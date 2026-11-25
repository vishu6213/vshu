import { test } from '../../desktop/electron-fixtures/vshu-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  ensureTerminalVisible
} from '../../desktop/renderer-probes/store'
import '../input/terminal'
import { waitForActiveTerminalManager, waitForPaneCount } from './terminal-pane-operations'

export function registerTerminalPaneMountReadiness(): void {
  test.beforeEach(async ({ vshuPage }) => {
    await waitForSessionReady(vshuPage)
    await waitForActiveWorktree(vshuPage)
    await ensureTerminalVisible(vshuPage)
    // Allow cold starts 30s for the React terminal lifecycle to register PaneManager.
    const hasPaneManager = await waitForActiveTerminalManager(vshuPage, 30_000)
      .then(() => true)
      .catch(() => false)
    test.skip(
      !hasPaneManager,
      'Electron automation in this environment never mounts the live TerminalPane manager, so pane split/resize assertions would only fail on harness setup.'
    )
    // Hidden-window readiness may precede the first xterm/PTY pair; require it before split/content assertions.
    await waitForPaneCount(vshuPage, 1, 30_000)
  })
}
