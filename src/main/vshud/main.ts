import '../memory/host-malloc-tunables-claim'
import '../ipc/pty/host-env/inherited-vshu-identity-claim'
import process from 'node:process'
import { main } from './serve-startup/vshud-command-startup'
import { resolveVshudExitCode } from './serve-startup/vshud-exit-code'
import { reserveServeStdoutForReadiness } from '../server/serve-stdout-boundary'
import { runVshudNativePreflightVerdict } from './native-runtime/vshud-native-preflight'
import {
  VSHUD_PROFILE_PREFLIGHT_FLAG,
  VSHUD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/remote-runtime/vshud-distribution/vshud-profile-preflight'
import { onNodePtyLoadFailure } from '../providers/pty/node-pty-load-failure'
import {
  confirmBundledVshudStartupQualified,
  discardBundledVshudStartupQualification,
  forgetBundledVshudStartupQualification,
  preflightBundledVshudStartup,
  runVshudProfilePreflight
} from './runtime-launch/vshud-profile-preflight'
import { assertVshudServerRuntime } from './runtime-launch/vshud-bundled-runtime'
import {
  formatVshudNativePreflightReport,
  VSHUD_NATIVE_PREFLIGHT_FLAG
} from '../../shared/remote-runtime/vshud-distribution/vshud-native-preflight-report'
import {
  VSHUD_CANCEL_MANAGED_STOP_FLAG,
  VSHUD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import {
  VSHUD_WINDOWS_BREAKAWAY_CONTRACT,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG
} from '../../shared/remote-runtime/vshud-lifecycle/windows-breakaway-launch'
import { runWindowsBreakawayLaunchIfRequested } from './runtime-launch/windows-breakaway-launcher'
import { parseArgs } from './serve-startup/vshud-command-arguments'
import { VSHUD_RECLAIM_STALE_LOCK_FLAG } from '../../shared/remote-runtime/vshud-lifecycle/vshud-stale-lock-reclaim'
import { installFatalSignalListenerGuard } from '../crash-reporting/fatal-signal-listener-guard'

// A fatal V8 trap must crash, never spin on a JS fault-signal listener.
installFatalSignalListenerGuard()

function failStartup(error: unknown): void {
  console.error('vshud: failed to start:', error)
  // Distinguish configuration refusals so supervisors cannot restart-spin on them.
  process.exit(resolveVshudExitCode(error))
}

// A resolved plain-Node module graph proves the build guard; skip probes, ports and data-root locks.
if (process.argv.includes('--vshud-smoke-load-check')) {
  // Activation loads lazily at startup; load it here so the guard still covers its graph.
  void import('../backend/core-runtime-activation').then(() => process.exit(0), failStartup)
} else if (process.argv[2] === '--vshud-structured-provider-load-check') {
  // One-shot launch and stop commands must skip server startup and preflights.
  void import('./native-runtime/vshud-structured-provider-smoke')
    .then(({ smokeLoadVshudStructuredProviders }) => smokeLoadVshudStructuredProviders())
    .then(() => process.exit(0))
    .catch(failStartup)
} else if (process.argv[2] === WINDOWS_BREAKAWAY_LAUNCH_FLAG) {
  runWindowsBreakawayLaunchIfRequested(VSHUD_WINDOWS_BREAKAWAY_CONTRACT, process.argv)
} else if (
  process.argv[2] === VSHUD_COMPLETE_MANAGED_STOP_FLAG ||
  process.argv[2] === VSHUD_CANCEL_MANAGED_STOP_FLAG
) {
  void import('./host-lifecycle/managed-stop/vshud-managed-stop-command').then(
    ({ runVshudManagedStopCommandAndExit }) =>
      runVshudManagedStopCommandAndExit(process.argv.slice(2))
  )
} else if (process.argv[2] === VSHUD_RECLAIM_STALE_LOCK_FLAG) {
  void import('./instance-lock/vshud-stale-lock-reclaim').then(
    ({ runVshudStaleLockReclaimCommandAndExit }) =>
      runVshudStaleLockReclaimCommandAndExit(process.argv.slice(2))
  )
} else {
  startVshudProcess()
}

function startVshudProcess(): void {
  try {
    const argv = process.argv.slice(2)
    if ((argv.includes('--help') || argv.includes('-h')) && parseArgs(argv).help) {
      void main(argv).catch(failStartup)
      return
    }
    assertVshudServerRuntime()
    const flag = process.argv[2]
    if (flag === VSHUD_NATIVE_PREFLIGHT_FLAG && process.argv.length === 3) {
      void import('./native-runtime/node-pty-precondition').then(({ checkNodePtyPrecondition }) => {
        const verdict = checkNodePtyPrecondition()
        const report = formatVshudNativePreflightReport(verdict.status, verdict.reason ?? null)
        process.stdout.write(`${report}\n`, () => process.exit(0))
      }, failStartup)
    } else if (
      (flag === VSHUD_STARTUP_PREFLIGHT_FLAG && process.argv.length === 4) ||
      (flag === VSHUD_PROFILE_PREFLIGHT_FLAG &&
        (process.argv.length === 4 || process.argv.length === 5))
    ) {
      void runVshudProfilePreflight(process.argv[3], {
        nativeFeatures: flag === VSHUD_PROFILE_PREFLIGHT_FLAG,
        servedUserDataPath: process.argv[4]
      })
        // The owner reads EOF; lingering native handles must not keep this probe alive.
        .then(() => process.stdout.write('', () => process.exit(0)))
        .catch(failStartup)
    } else {
      // Stdout is the readiness API; send incidental diagnostics to stderr.
      reserveServeStdoutForReadiness()
      void preflightBundledVshudStartup()
        .then((qualified) => {
          onNodePtyLoadFailure(() => void discardBundledVshudStartupQualification())
          // Probe before deferred node-pty loading can crash this process; a slot qualified on this
          // unchanged host passed it on its last launch.
          if (runVshudNativePreflightVerdict({ qualified }) !== 'ok') {
            forgetBundledVshudStartupQualification()
          }
          return main()
        })
        .then(confirmBundledVshudStartupQualified)
        .catch(failStartup)
    }
  } catch (error) {
    failStartup(error)
  }
}
