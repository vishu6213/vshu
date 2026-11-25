// The servers a terminal pane of an agent gets from the host list, shaped for its CLI before relay
// addresses are filled in: saved env behind `vshu mcp exec` on this host, and in WSL everything that
// needs Vshu behind the guest's `vshu`.
import { access } from 'node:fs/promises'
import type { BotToolServer } from '../../../shared/bot-tools'
import { mcpServerWorkspaceKeyOf } from '../../../shared/mcp-servers/mcp-servers'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { thisAppVshuCliLauncher } from '../../cli/launchers/this-app-vshu-cli-launcher'
import { cmdShimArgument } from '../../bots/bot-tools-claude'
import { mcpServerEntriesForLaunch, type McpLaunchEntry } from '../mcp-host-list-launch'
import { mcpHostListFolder } from '../mcp-host-list-folder'
import {
  settleWslMountRoot,
  wslConnectServer,
  wslGuestVshuLauncher,
  wslSavedEnvServer
} from './terminal-mcp-wsl-servers'

/** The `vshu` launcher this host's terminals run, and the user data it names its Vshu by; null when
 *  this host has none to run (a dev serve never installs one). */
async function vshuCliLauncher(): Promise<{ launcher: string; userDataPath: string } | null> {
  if (!hasAppEnvironment()) {
    return null
  }
  const userDataPath = getAppEnvironment().getPath('userData')
  const launcher = thisAppVshuCliLauncher(userDataPath)
  const found = launcher
    ? await access(launcher).then(
        () => true,
        () => false
      )
    : false
  return launcher && found ? { launcher, userDataPath } : null
}

/**
 * A command server with saved env as `vshu mcp exec <id>`: the CLI fetches the env from the running
 * Vshu and execs the real command, so no saved value sits in the agent's config, argv or env.
 * `VSHU_USER_DATA_PATH` is named outright since agents start servers with a trimmed environment.
 */
function throughVshuExec(
  entry: McpLaunchEntry,
  launch: { agent: string; workspaceId: string | null },
  cli: { launcher: string; userDataPath: string } | null
): BotToolServer | null {
  const { server } = entry
  if ('url' in server || Object.keys(server.env ?? {}).length === 0) {
    return server
  }
  if (!entry.id || !cli) {
    return null
  }
  const args = [
    'mcp',
    'exec',
    entry.id,
    '--agent',
    launch.agent,
    ...(launch.workspaceId ? ['--workspace', launch.workspaceId] : [])
  ]
  // A dev build's Windows launcher is a .cmd, which Node-based agents can only start through cmd.
  const viaCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli.launcher)
  return {
    name: server.name,
    command: viaCmd ? 'cmd' : cli.launcher,
    args: viaCmd ? ['/c', cli.launcher, ...args.map(cmdShimArgument)] : args,
    env: { VSHU_USER_DATA_PATH: cli.userDataPath }
  }
}

export type WslLaunch = { distro: string | null } | null

/**
 * The servers a pane of `agent` gets, shaped for a terminal. A command server Vshu runs once for
 * every session stays as it is here: SessionMcpTools points the agent at it through the relay. In
 * WSL, every server that needs Vshu goes through the guest's `vshu` (terminal-mcp-wsl-servers.ts).
 */
export async function terminalServers(
  agent: string,
  workspaceId: string | null,
  wsl: WslLaunch,
  deps: { hostFolder?: string }
): Promise<{
  folder: string
  servers: BotToolServer[]
  sharedProcesses: ReadonlyMap<string, string>
  bridged: BotToolServer[]
}> {
  const folder = deps.hostFolder ?? mcpHostListFolder()
  const key = workspaceId ? mcpServerWorkspaceKeyOf(workspaceId) : null
  const { entries, sharedProcesses } = await mcpServerEntriesForLaunch(agent, { key }, folder)
  const shared = (server: BotToolServer): boolean => sharedProcesses.has(server.name)
  const savedEnv = (server: BotToolServer): boolean =>
    !('url' in server) && !shared(server) && Object.keys(server.env ?? {}).length > 0
  const relayed = (server: BotToolServer): boolean =>
    'url' in server ? server.credential !== undefined : shared(server)
  const needsVshu = entries.some(({ server }) => savedEnv(server) || (wsl && relayed(server)))
  const cli = wsl || !needsVshu ? null : await vshuCliLauncher()
  if (wsl && entries.length > 0) {
    // Guest paths (the launcher's here, the launch files' later) follow where this distro mounts
    // Windows drives, which it reports once per start.
    await settleWslMountRoot(wsl.distro)
  }
  const guest = wsl && needsVshu ? wslGuestVshuLauncher(wsl.distro) : null
  const wslLaunch = { agent, workspaceId, launcher: guest }
  const bridged: BotToolServer[] = []
  const servers = entries.flatMap((entry) => {
    const { server } = entry
    const shaped = !wsl
      ? shared(server)
        ? server
        : throughVshuExec(entry, { agent, workspaceId }, cli)
      : relayed(server)
        ? wslConnectServer(entry, wslLaunch)
        : savedEnv(server)
          ? wslSavedEnvServer(entry, wslLaunch)
          : server
    if (shaped && shaped !== server) {
      bridged.push(server)
    }
    return shaped ? [shaped] : []
  })
  // In WSL a shared server is already an `vshu mcp connect` entry, not a relay address.
  return { folder, servers, sharedProcesses: wsl ? new Map() : sharedProcesses, bridged }
}
