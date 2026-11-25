// The `vshu serve` service and the terminal daemon: the processes Vshu leaves running.
import {
  listInstalledServeServiceUnits,
  removeServeServiceUnit,
  runServeServiceManager
} from '../../shared/remote-runtime/serve-supervisor/serve-service-unit-removal'
import { collapseHomePath } from '../../shared/skills/bundled/bundled-skill-locations'
import type {
  VshuUninstallPlan,
  VshuUninstallSimpleEntry
} from '../../shared/uninstall/vshu-uninstall-types'
import { daemonRuntimeDirFor } from '../daemon/endpoint/publication/daemon-runtime-dir'
import type { VshuUninstallHost } from './vshu-uninstall-cleanup'
import { vshuUninstallErrorText as errorText } from './vshu-uninstall-error-text'

export async function serviceEntry(
  host: VshuUninstallHost
): Promise<VshuUninstallSimpleEntry | null> {
  const units = await listInstalledServeServiceUnits(host.platform, host.homeDir)
  return units.length === 0
    ? null
    : { location: units.map((unit) => unit.name).join(', '), state: 'present', detail: null }
}

export async function terminalDaemonEntry(
  host: VshuUninstallHost
): Promise<VshuUninstallSimpleEntry | null> {
  return (await host.isTerminalDaemonLive().catch(() => false))
    ? {
        location: collapseHomePath(daemonRuntimeDirFor(host.userDataPath), host.homeDir),
        state: 'present',
        detail: null
      }
    : null
}

export async function runBackgroundService(
  plan: VshuUninstallPlan,
  host: VshuUninstallHost
): Promise<VshuUninstallSimpleEntry | null> {
  const entry = plan.backgroundService
  if (!entry || entry.state === 'removed') {
    return entry
  }
  const run = host.runServiceManager ?? runServeServiceManager
  try {
    for (const unit of await listInstalledServeServiceUnits(host.platform, host.homeDir)) {
      await removeServeServiceUnit(unit, run, host.uid)
    }
  } catch (error) {
    return { ...entry, state: 'error', detail: errorText(error) }
  }
  const left = await listInstalledServeServiceUnits(host.platform, host.homeDir)
  return left.length === 0
    ? { ...entry, state: 'removed', detail: null }
    : { ...entry, state: 'error', detail: `Still installed: ${left.map((u) => u.name).join(', ')}` }
}

export async function runTerminalDaemon(
  plan: VshuUninstallPlan,
  host: VshuUninstallHost
): Promise<VshuUninstallSimpleEntry | null> {
  const entry = plan.terminalDaemon
  if (!entry || entry.state === 'removed') {
    return entry
  }
  try {
    await host.stopTerminalDaemon()
    return { ...entry, state: 'removed', detail: null }
  } catch (error) {
    return { ...entry, state: 'error', detail: errorText(error) }
  }
}
