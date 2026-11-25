import { removeWorktreeViaStore } from '../terminal/input/dead-terminal'
import { openSidebarWorkspaceComposer } from '../workspaces/sidebar/sidebar-project-dialog'
import type { Page } from '@stablyai/playwright-test'
import { test } from '../desktop/electron-fixtures/vshu-app'
import { expect } from '@stablyai/playwright-test'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  waitForActiveWorktree,
  waitForSessionReady
} from '../desktop/renderer-probes/store'
import { createTerminalTabFromMenu } from '../terminal/layout/terminal-tab-menu'
import { waitForActivePanePtyId } from '../terminal/input/terminal'
import {
  execInTerminal,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from '../terminal/layout/terminal-pane-operations'
import { splitMarkerEchoCommand } from '../terminal/input/terminal-marker-echo-command'
import { waitForPtyShellEcho } from '../terminal/lifecycle/terminal-pty-readiness'

async function createWorkspace(page: Page, name: string): Promise<void> {
  await openSidebarWorkspaceComposer(page)
  const dialog = page.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder(/Type a name/i).fill(name)
  await dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i }).click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

test('creates a worktree, keeps its terminal isolated, and switches back @golden', async ({
  vshuPage
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(vshuPage)
  const originalWorktreeId = await waitForActiveWorktree(vshuPage)
  await waitForActiveTerminalManager(vshuPage, 30_000)
  const parentPtyId = await waitForActivePanePtyId(vshuPage)
  const workspaceName = `golden-switch-${Date.now()}`
  let childWorktreeId: string | null = null

  try {
    await createWorkspace(vshuPage, workspaceName)
    await expect(
      vshuPage.locator('[role="option"][aria-current="page"]').filter({ hasText: workspaceName })
    ).toBeVisible({ timeout: 30_000 })
    childWorktreeId = await waitForActiveWorktree(vshuPage)
    // Why: the cleanup force-removes childWorktreeId, so it must never resolve to the original.
    expect(childWorktreeId).not.toBe(originalWorktreeId)
    await expect(
      vshuPage.locator(`[role="option"][data-worktree-id="${childWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page')

    await createTerminalTabFromMenu(vshuPage)
    await waitForActiveTerminalManager(vshuPage, 30_000)
    const childPtyId = await waitForActivePanePtyId(vshuPage)
    expect(childPtyId).not.toBe(parentPtyId)
    await waitForPtyShellEcho(vshuPage, childPtyId, 15_000)
    await execInTerminal(vshuPage, childPtyId, splitMarkerEchoCommand('worktree', '-b'))
    await waitForTerminalOutput(vshuPage, 'worktree-b')

    await vshuPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`).click()
    await expect(
      vshuPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })
    // Wait for store activation too: sidebar aria-current can precede the child terminal’s manager remount.
    await expect
      .poll(() => getActiveWorktreeId(vshuPage), {
        timeout: 20_000,
        message: 'store did not activate the original worktree after sidebar click'
      })
      .toBe(originalWorktreeId)
    await ensureTerminalVisible(vshuPage)
    await waitForActiveTerminalManager(vshuPage, 30_000)
    expect(await waitForActivePanePtyId(vshuPage, 30_000)).toBe(parentPtyId)
  } finally {
    if (childWorktreeId) {
      if ((await getActiveWorktreeId(vshuPage).catch(() => null)) !== originalWorktreeId) {
        await vshuPage
          .locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
          .click()
          .catch(() => undefined)
      }
      await removeWorktreeViaStore(vshuPage, childWorktreeId)
    }
  }
})
