import { startVshud } from '../host-runtime/vshud-entry'
import process from 'node:process'
import { resolveVshudInstallRoot } from '../host-runtime/vshud-app-paths'
import { VSHUD_USAGE, parseArgs } from './vshud-command-arguments'
import {
  installVshudShutdownSignals,
  type VshudShutdownTrigger
} from '../host-lifecycle/vshud-lifecycle'
import { installVshudProcessErrorGuards } from '../host-lifecycle/vshud-process-error-guards'
import { installVshudStopRequestListeners } from '../host-lifecycle/managed-stop/vshud-stop-request-listener'
import { prepareVshudManagedStop } from '../host-lifecycle/managed-stop/vshud-managed-stop-admission'
import { bindVshudIdleShutdown } from '../host-lifecycle/idle-exit/vshud-managed-idle-exit-host'

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(VSHUD_USAGE)
    return
  }
  let shutdownTrigger: VshudShutdownTrigger | null = null
  // Fire-and-forget startup work can reject before its first await completes.
  installVshudProcessErrorGuards(() => shutdownTrigger)
  const startup = startVshud(options)
  const requestShutdown = installVshudShutdownSignals(async () => (await startup).stop())
  shutdownTrigger = requestShutdown
  const handle = await startup
  // Stop requests must name the runtime/instance established by startup.
  installVshudStopRequestListeners(() => requestShutdown('stop request'), {
    installRoot: resolveVshudInstallRoot(),
    managedStop: handle.managedStop,
    beforeManagedStop: prepareVshudManagedStop
  })
  bindVshudIdleShutdown(requestShutdown)
}
