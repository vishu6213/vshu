import type { RuntimePtyWorktreeRecord } from '../../../terminal/records/runtime-terminal-state-records'
import { isStructuredWorkerHandle } from '../../../../../shared/orchestration/workers/structured-worker-handle'
import { parseVshuSessionAddress } from '../../../../../shared/agent-session/identity/vshu-session-address'
import type { ProjectExecutionRuntimeResolution } from '../../../../../shared/execution-host/project-execution-runtime'
import { isWslUncPath } from '../../../../../shared/file-access/wsl-paths'
import { splitWorktreeIdForFilesystem } from '../../../../../shared/worktree/id'
import {
  getAppEnvironment,
  hasAppEnvironment
} from '../../../../../shared/app-lifecycle/app-environment'

export type OrchestrationCliCommand = 'vshu' | 'vshu-dev' | 'vshu-ide'

/** Dev builds run the CLI as `vshu-dev`; a packaged app, or a process with no app, must not advertise it. */
export function runtimeOrchestrationCliCommand(): OrchestrationCliCommand | undefined {
  return hasAppEnvironment() && !getAppEnvironment().isPackaged() ? 'vshu-dev' : undefined
}

/** What a local, non-WSL terminal is told to run; a structured session is always one. */
export function localOrchestrationCliCommand(): OrchestrationCliCommand {
  return runtimeOrchestrationCliCommand() ?? 'vshu'
}

export function resolveTerminalOrchestrationCliCommand(args: {
  connectionId: string | null
  isWsl: boolean | null | undefined
  worktreeId: string
  /** Read only when nothing cheaper decides: it searches the project catalog. */
  getProjectRuntime?: () => ProjectExecutionRuntimeResolution | undefined
  runtimeCliCommand?: OrchestrationCliCommand
}): OrchestrationCliCommand {
  if (args.connectionId) {
    return 'vshu'
  }
  if (args.runtimeCliCommand) {
    return args.runtimeCliCommand
  }
  if (args.isWsl !== null && args.isWsl !== undefined) {
    return args.isWsl ? 'vshu-ide' : 'vshu'
  }
  const projectRuntime = args.getProjectRuntime?.()
  if (projectRuntime?.status === 'resolved' && projectRuntime.runtime.kind === 'wsl') {
    return 'vshu-ide'
  }

  const worktreePath = splitWorktreeIdForFilesystem(args.worktreeId)?.worktreePath
  return worktreePath && isWslUncPath(worktreePath) ? 'vshu-ide' : 'vshu'
}

export function resolveRuntimeTerminalOrchestrationCliCommand(
  handle: string,
  source: {
    resolvePtyId: (handle: string) => string | null | undefined
    getPty: (ptyId: string) => RuntimePtyWorktreeRecord | undefined
    getProjectRuntime: (
      pty: RuntimePtyWorktreeRecord
    ) => ProjectExecutionRuntimeResolution | undefined
  }
): OrchestrationCliCommand {
  // A structured session runs in this process: it is told what the structured mail lane types.
  if (isStructuredWorkerHandle(handle) || parseVshuSessionAddress(handle)) {
    return localOrchestrationCliCommand()
  }
  let pty: RuntimePtyWorktreeRecord | null = null
  try {
    const ptyId = source.resolvePtyId(handle)
    pty = ptyId ? (source.getPty(ptyId) ?? null) : null
  } catch {
    return 'vshu'
  }
  if (!pty) {
    return 'vshu'
  }
  return resolveTerminalOrchestrationCliCommand({
    connectionId: pty.connectionId,
    isWsl: pty.isWsl,
    worktreeId: pty.worktreeId,
    runtimeCliCommand: runtimeOrchestrationCliCommand(),
    getProjectRuntime: () => source.getProjectRuntime(pty)
  })
}
