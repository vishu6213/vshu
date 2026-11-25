import 'node:fs/promises'
import 'node:os'
import 'node:path'
import { describe, expect, it, vi } from 'vitest'
import '../../construction/test-context/runtime-test-module-registration.spec'
import { VshuRuntimeService } from '../../vshu-runtime'
import { electronMocks } from '../../vshu-runtime-test-mocks/setup.spec'
import '../../../../shared/vshu-profiles/constants'
import { ipcMain } from 'electron'
import '../../rpc/dispatcher'
import '../../rpc/methods/terminal/terminal'
import {
  TEST_WORKTREE_ID,
  store
} from '../../construction/test-context/vshu-runtime-test-fixtures.spec'
import './spawned-pty-env-fixtures'
import '../../construction/test-context/vshu-runtime-test-scenario-builders.spec'

describe('VshuRuntimeService', () => {
  // A timed-out renderer create could finish later and duplicate a retried terminal.

  it('accepts workspace-less terminal create replies only from the target renderer', async () => {
    const webContents = { send: vi.fn() }
    const send = vi.fn(async (_channel: string, payload: { requestId: string }) => {
      ipcMain.emit(
        'terminal:tabCreateReply',
        { sender: { send: vi.fn() } },
        { requestId: payload.requestId, error: 'spoofed renderer reply' }
      )
      await runtime.syncWindowGraph(1, {
        tabs: [
          {
            tabId: 'tab-renderer',
            worktreeId: TEST_WORKTREE_ID,
            title: 'Renderer Terminal',
            activeLeafId: 'pane:1',
            layout: null
          }
        ],
        leaves: [
          {
            tabId: 'tab-renderer',
            worktreeId: TEST_WORKTREE_ID,
            leafId: 'pane:1',
            paneRuntimeId: 1,
            ptyId: 'pty-renderer',
            paneTitle: null
          }
        ]
      })
      ipcMain.emit(
        'terminal:tabCreateReply',
        { sender: webContents },
        { requestId: payload.requestId, tabId: 'tab-renderer', title: 'Renderer Terminal' }
      )
    })
    webContents.send = send
    const runtime = new VshuRuntimeService(store)
    runtime.attachWindow(1)
    await runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    electronMocks.BrowserWindow.fromId.mockReturnValue({
      isDestroyed: () => false,
      webContents
    })

    await expect(
      runtime.createTerminal(undefined, {
        command: 'codex',
        title: 'Renderer Terminal'
      })
    ).resolves.toMatchObject({
      handle: expect.stringMatching(/^term_/),
      tabId: 'tab-renderer',
      title: 'Renderer Terminal',
      surface: 'visible'
    })
    expect(send).toHaveBeenCalledWith(
      'terminal:requestTabCreate',
      expect.objectContaining({
        requestId: expect.any(String),
        command: 'codex',
        title: 'Renderer Terminal'
      })
    )
    expect(electronMocks.ipcMain.removeListener).toHaveBeenCalledWith(
      'terminal:tabCreateReply',
      expect.any(Function)
    )
  })
})
