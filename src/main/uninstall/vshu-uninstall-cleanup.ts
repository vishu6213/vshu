import { access, readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-listener/configuration/agent-hook-types'
import { isManagedAgentHookTarget } from '../../shared/agent-hook-listener/configuration/managed-agent-hook-targets'
import type { CliInstallStatus } from '../../shared/cli/cli-install-types'
import type { ServeServiceRun } from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import type {
  VshuUninstallAgentEntry,
  VshuUninstallHostEntry,
  VshuUninstallPlan,
  VshuUninstallSimpleEntry,
  VshuUninstallStep
} from '../../shared/uninstall/vshu-uninstall-types'
import {
  getManagedAgentHookStatuses,
  removeManagedAgentHooks
} from '../agent-hooks/installation/managed-agent-hook-controls'
import {
  findPluginHookFiles,
  removePluginHookFiles,
  type PluginHookRemoval
} from '../agent-hooks/installation/opencode-pi-plugin-hook-files'
import type { VshuInstallIdentity } from './vshu-install-identity'
import { forgetClaudeAgentViewMarkers } from '../claude/agent-view/agent-view-uninstall'
import { collapseHomePath } from '../../shared/skills/bundled/bundled-skill-locations'
import { describeVshuUninstallPath } from './vshu-uninstall-path-display'
import {
  runBackgroundService,
  runTerminalDaemon,
  serviceEntry,
  terminalDaemonEntry
} from './vshu-uninstall-background-processes'
import { vshuUninstallErrorText as errorText } from './vshu-uninstall-error-text'

/** What the desktop app supplies to the cleanup. */
export type VshuUninstallHost = {
  platform: NodeJS.Platform
  homeDir: string
  userDataPath: string
  uid: number
  identity: VshuInstallIdentity
  /** Persists `agentStatusHooksEnabled: false`, so startup reconciliation cannot reinstall. */
  disableAgentStatusHooks: () => Promise<void>
  /** Null when this host cannot read the `vshu` command registration. */
  getCliStatus: () => Promise<CliInstallStatus | null>
  removeCli: () => Promise<CliInstallStatus>
  listHosts: () => Promise<VshuUninstallHostEntry[]>
  removeHostHooks: (hostId: string) => Promise<void>
  runServiceManager?: ServeServiceRun
  isTerminalDaemonLive: () => Promise<boolean>
  /** Ends the daemon and every terminal it runs; throws if one is still running. */
  stopTerminalDaemon: () => Promise<void>
}

const PLUGIN_AGENTS: ReadonlySet<string> = new Set(['opencode', 'pi', 'omp', 'prime-agent'])

function isVshuOwnedCli(status: CliInstallStatus | null): status is CliInstallStatus {
  return status !== null && (status.state === 'installed' || status.state === 'stale')
}

/** Read-only: lists what Vshu added outside its own folders. */
export async function buildVshuUninstallPlan(host: VshuUninstallHost): Promise<VshuUninstallPlan> {
  const registryAgents: VshuUninstallAgentEntry[] = getManagedAgentHookStatuses()
    .filter((status) => status.managedHooksPresent)
    .map((status) => ({
      agent: status.agent,
      paths: status.configPath ? [describeVshuUninstallPath(status.configPath, host)] : [],
      state: 'present',
      detail: null
    }))
  const pluginAgents: VshuUninstallAgentEntry[] = (
    await findPluginHookFiles({ homeDir: host.homeDir })
  ).map((entry) => ({
    ...entry,
    paths: entry.paths.map((path) => describeVshuUninstallPath(path, host)),
    state: 'present',
    detail: null
  }))
  const cli = await host.getCliStatus().catch(() => null)
  const scripts = join(host.homeDir, '.vshu', 'agent-hooks')
  const scriptsMissing = await access(scripts).catch(() => true)
  return {
    installKind: host.identity.installKind,
    agents: [...registryAgents, ...pluginAgents],
    cliCommand: isVshuOwnedCli(cli)
      ? {
          commandName: cli.commandName,
          location: cli.commandPath
            ? collapseHomePath(cli.commandPath, host.homeDir)
            : cli.commandName,
          state: 'present',
          detail: null
        }
      : null,
    backgroundService: await serviceEntry(host),
    hookScripts: !scriptsMissing
      ? { location: collapseHomePath(scripts, host.homeDir), state: 'present', detail: null }
      : null,
    hosts: await host.listHosts(),
    terminalDaemon: await terminalDaemonEntry(host),
    otherVshuBuildName: host.identity.otherVshuBuildName,
    appPath: host.identity.appPath,
    removeAppCommand: host.identity.removeAppCommand
  }
}

function isPending(
  entry: { state: string },
  only: ReadonlySet<string> | null,
  id: string
): boolean {
  return entry.state !== 'removed' && (only === null || only.has(id))
}

function registryOutcome(
  status: AgentHookInstallStatus | undefined
): Pick<VshuUninstallAgentEntry, 'state' | 'detail'> {
  if (!status) {
    return { state: 'removed', detail: null }
  }
  if (status.state === 'error' || status.managedHooksPresent) {
    return { state: 'error', detail: status.detail ?? 'Vshu hooks are still in this file.' }
  }
  return { state: 'removed', detail: null }
}

async function runAgentHooks(
  plan: VshuUninstallPlan,
  host: VshuUninstallHost,
  only: ReadonlySet<string> | null
): Promise<VshuUninstallAgentEntry[]> {
  const pending = plan.agents.filter((entry) => isPending(entry, only, entry.agent))
  if (pending.length === 0) {
    return plan.agents
  }
  const update = (
    outcome: (entry: VshuUninstallAgentEntry) => Pick<VshuUninstallAgentEntry, 'state' | 'detail'>
  ): VshuUninstallAgentEntry[] =>
    plan.agents.map((entry) => (pending.includes(entry) ? { ...entry, ...outcome(entry) } : entry))
  const otherBuild = plan.otherVshuBuildName
  if (otherBuild) {
    return update(() => ({ state: 'kept-shared', detail: `${otherBuild} still uses these hooks.` }))
  }
  try {
    await host.disableAgentStatusHooks()
  } catch (error) {
    const detail = `Could not turn off agent status hooks: ${errorText(error)}`
    return update(() => ({ state: 'error', detail }))
  }
  const pluginRemovals = new Map<string, PluginHookRemoval>(
    (
      await removePluginHookFiles({
        homeDir: host.homeDir,
        agents: pending.map((entry) => entry.agent)
      })
    ).map((removal) => [removal.agent, removal])
  )
  const registryAgents = pending.map((entry) => entry.agent).filter(isManagedAgentHookTarget)
  const statuses = new Map<string, AgentHookInstallStatus>(
    registryAgents.length === 0
      ? []
      : (await removeManagedAgentHooks({ agents: registryAgents })).map((status) => [
          status.agent,
          status
        ])
  )
  const claude = statuses.get('claude')
  if (claude && registryOutcome(claude).state === 'removed') {
    await forgetClaudeAgentViewMarkers().catch(() => {})
  }
  return update((entry) => {
    const plugin = pluginRemovals.get(entry.agent)
    if (plugin) {
      return plugin.error
        ? { state: 'error', detail: plugin.error }
        : { state: 'removed', detail: null }
    }
    return PLUGIN_AGENTS.has(entry.agent)
      ? { state: 'removed', detail: null }
      : registryOutcome(statuses.get(entry.agent))
  })
}

async function runCliCommand(
  plan: VshuUninstallPlan,
  host: VshuUninstallHost
): Promise<VshuUninstallPlan['cliCommand']> {
  const entry = plan.cliCommand
  if (!entry || entry.state === 'removed') {
    return entry
  }
  try {
    const status = await host.removeCli()
    return isVshuOwnedCli(status)
      ? { ...entry, state: 'error', detail: status.detail ?? 'The command is still registered.' }
      : { ...entry, state: 'removed', detail: null }
  } catch (error) {
    return { ...entry, state: 'error', detail: errorText(error) }
  }
}

async function runHookScripts(
  plan: VshuUninstallPlan,
  host: VshuUninstallHost
): Promise<VshuUninstallSimpleEntry | null> {
  const entry = plan.hookScripts
  if (!entry || entry.state === 'removed') {
    return entry
  }
  if (plan.otherVshuBuildName) {
    return { ...entry, state: 'kept-shared', detail: `${plan.otherVshuBuildName} still uses them.` }
  }
  // Hook entries left in an agent's config still call these scripts on every event.
  const stillHooked = plan.agents.filter(
    (agent) => agent.state !== 'removed' && !PLUGIN_AGENTS.has(agent.agent)
  )
  if (stillHooked.length > 0) {
    const names = stillHooked.map((agent) => agent.agent).join(', ')
    return { ...entry, state: 'kept-shared', detail: `Still used by ${names}.` }
  }
  try {
    const dir = join(host.homeDir, '.vshu', 'agent-hooks')
    await rm(dir, { recursive: true, force: true })
    const vshuDir = join(host.homeDir, '.vshu')
    if ((await readdir(vshuDir).catch(() => ['?'])).length === 0) {
      await rmdir(vshuDir)
    }
    return { ...entry, state: 'removed', detail: null }
  } catch (error) {
    return { ...entry, state: 'error', detail: errorText(error) }
  }
}

async function runSshHosts(
  plan: VshuUninstallPlan,
  host: VshuUninstallHost,
  only: ReadonlySet<string> | null
): Promise<VshuUninstallHostEntry[]> {
  const results: VshuUninstallHostEntry[] = []
  for (const entry of plan.hosts) {
    if (!isPending(entry, only, entry.hostId)) {
      results.push(entry)
      continue
    }
    // A Retry targets the host, so try it even if it was offline when the plan was built.
    if (!entry.connected && only === null) {
      results.push({ ...entry, state: 'needs-user', detail: 'Not connected.' })
      continue
    }
    try {
      await host.removeHostHooks(entry.hostId)
      results.push({ ...entry, connected: true, state: 'removed', detail: null })
    } catch (error) {
      results.push({
        ...entry,
        state: entry.connected ? 'error' : 'needs-user',
        detail: errorText(error)
      })
    }
  }
  return results
}

/** Runs one step and returns the whole plan with that step's entries updated. */
export async function runVshuUninstallStep(
  plan: VshuUninstallPlan,
  step: VshuUninstallStep,
  host: VshuUninstallHost,
  only?: readonly string[]
): Promise<VshuUninstallPlan> {
  const filter = only && only.length > 0 ? new Set(only) : null
  switch (step) {
    case 'agent-hooks':
      return { ...plan, agents: await runAgentHooks(plan, host, filter) }
    case 'cli-command':
      return { ...plan, cliCommand: await runCliCommand(plan, host) }
    case 'background-service':
      return { ...plan, backgroundService: await runBackgroundService(plan, host) }
    case 'hook-scripts':
      return { ...plan, hookScripts: await runHookScripts(plan, host) }
    case 'ssh-hosts':
      return { ...plan, hosts: await runSshHosts(plan, host, filter) }
    case 'terminal-daemon':
      return { ...plan, terminalDaemon: await runTerminalDaemon(plan, host) }
  }
}
