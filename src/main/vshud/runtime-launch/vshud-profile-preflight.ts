import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightProfileStateRuntime } from '../../persistence/profile-state/startup/profile-state-runtime-preflight'
import {
  VSHUD_STARTUP_PREFLIGHT_FLAG,
  VSHUD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseVshudProfilePreflight,
  vshudProfilePreflightResponseSchema,
  type VshudProfilePreflightResponse
} from '../../../shared/remote-runtime/vshud-distribution/vshud-profile-preflight'
import { readVshudArtifactIdentity } from '../artifact-slots/vshud-artifact-identity'
import { VSHUD_EXIT_CONFIGURATION } from '../serve-startup/vshud-configuration-exit'
import {
  VSHUD_SERVER_ENTRY_FILENAME,
  VSHUD_VERSION_FILENAME
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import { VSHUD_NODE_RUNTIME_IDENTITY } from '../../../shared/remote-runtime/vshud-distribution/vshud-node-runtime-identity'
import { runProcess } from '@vshu/process-host'
import { preflightVshudNativeRuntime } from '../native-runtime/vshud-runtime-native-preflight'
import { vshudCompileCacheEnv } from './vshud-compile-cache'
import {
  consumeVshudStartupQualification,
  discardVshudStartupQualification,
  isQualifiableVshudSlot,
  vshudStartupQualificationKey,
  recordVshudStartupQualification
} from './vshud-startup-qualification'
import {
  isRunningAsBundledVshudRuntime,
  VshudBundledRuntimeError,
  resolveBundledVshudSlot
} from './vshud-bundled-runtime'

let pendingQualification: { directory: string; key: string } | null = null
// The last marker write; recording fails open, so it never rejects.
let markerRecording: Promise<void> = Promise.resolve()

/** Qualify packaged startup before touching profile indexes, data-root locks or imports. */
export async function preflightBundledVshudStartup(): Promise<boolean> {
  const directory = resolveBundledVshudSlot()
  if (!isRunningAsBundledVshudRuntime(directory)) {
    return false
  }
  const identity = await readInstalledVersion(directory)
  // Windows' child also proves the process identity table, which depends on host services.
  const key =
    process.platform === 'win32' || !isQualifiableVshudSlot(directory)
      ? null
      : await vshudStartupQualificationKey(directory, identity).catch(() => null)
  if (key && (await consumeVshudStartupQualification(directory, key))) {
    pendingQualification = { directory, key }
    return true
  }
  try {
    await runStartupPreflightChild(directory, identity)
  } catch (error) {
    if (key) {
      await discardVshudStartupQualification(directory)
    }
    throw error
  }
  pendingQualification = key ? { directory, key } : null
  return false
}

/** node-pty failed to load at spawn: the next launch must re-probe and report why. */
export async function discardBundledVshudStartupQualification(): Promise<void> {
  pendingQualification = null
  // A record still renaming its marker into place would recreate it after an earlier unlink.
  await markerRecording
  const directory = resolveBundledVshudSlot()
  if (process.platform !== 'win32' && isQualifiableVshudSlot(directory)) {
    await discardVshudStartupQualification(directory)
  }
}

/** A launch whose node-pty probe did not pass must not let the next one skip either probe. */
export function forgetBundledVshudStartupQualification(): void {
  pendingQualification = null
}

async function runStartupPreflightChild(directory: string, identity: string): Promise<void> {
  const nonce = randomUUID()
  // Keep disposable SQLite ownership and native state out of the serving process.
  const result = await runProcess({
    program: process.execPath,
    args: [join(directory, VSHUD_SERVER_ENTRY_FILENAME), VSHUD_STARTUP_PREFLIGHT_FLAG, nonce],
    // Reuse the serving runtime code cache for this identical bundle.
    env: { ...process.env, VSHU_BACKGROUND_LAUNCH: '1', ...vshudCompileCacheEnv(directory) },
    timeoutMs: VSHUD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    terminationBarrier: true
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    const Failure = result.code === VSHUD_EXIT_CONFIGURATION ? VshudBundledRuntimeError : Error
    throw new Failure(`The bundled Vshu runtime failed readiness: ${result.stderr}`)
  }
  try {
    parseVshudProfilePreflight(result.stdout, nonce, VSHUD_NODE_RUNTIME_IDENTITY, identity)
  } catch (cause) {
    throw new VshudBundledRuntimeError('The bundled runtime returned invalid readiness identity', {
      cause
    })
  }
}

/** Call once readiness is published: only a launch that got there lets the next one skip. */
export async function confirmBundledVshudStartupQualified(): Promise<void> {
  const qualified = pendingQualification
  pendingQualification = null
  if (qualified) {
    markerRecording = recordVshudStartupQualification(qualified.directory, qualified.key)
    await markerRecording
  }
}

export async function runVshudProfilePreflight(
  nonce: string | undefined,
  options: { nativeFeatures?: boolean; servedUserDataPath?: string } = {}
): Promise<void> {
  const checkedNonce = z.string().uuid().parse(nonce)
  const directory = resolveBundledVshudSlot()
  let artifactVersion: string
  try {
    artifactVersion = await readVshudArtifactIdentity(directory)
  } catch (cause) {
    throw new VshudBundledRuntimeError('The bundled Vshu artifacts are incomplete or altered', {
      cause
    })
  }
  const result = await preflightProfileStateRuntime()
  // Host Node rollback launchers do not serve the bundled slot.
  if (isRunningAsBundledVshudRuntime(directory)) {
    await preflightVshudNativeRuntime(options)
  }
  const response: VshudProfilePreflightResponse = {
    type: 'vshu_profile_state_ready',
    nonce: checkedNonce,
    runtime: 'node',
    runtimeVersion: process.versions.node,
    artifactVersion,
    ...result,
    ...(options.servedUserDataPath === undefined
      ? {}
      : { liveDaemonProtocols: await readServedDaemonProtocols(options.servedUserDataPath) })
  }
  console.log(JSON.stringify(response))
}

/** The served data root, never this probe's own, decides which daemons a restart must reach. */
async function readServedDaemonProtocols(servedUserDataPath: string): Promise<number[] | null> {
  // A failed probe leaves the crossing unverifiable; it must not fail the candidate itself.
  try {
    // Import lazily: startup preflight loads this module and needs no daemon code.
    const [{ listLiveDaemonProtocols }, { daemonRuntimeDirFor }, protocol] = await Promise.all([
      import('../../daemon/launch/daemon-generation-liveness'),
      import('../../daemon/endpoint/publication/daemon-runtime-dir'),
      import('../../daemon/protocol/daemon-protocol-version')
    ])
    return await listLiveDaemonProtocols(daemonRuntimeDirFor(servedUserDataPath), [
      protocol.PROTOCOL_VERSION,
      ...protocol.PREVIOUS_DAEMON_PROTOCOL_VERSIONS
    ])
  } catch {
    return null
  }
}

async function readInstalledVersion(directory: string): Promise<string> {
  try {
    return vshudProfilePreflightResponseSchema.shape.artifactVersion.parse(
      (await readFile(join(directory, VSHUD_VERSION_FILENAME), 'utf8')).trim()
    )
  } catch (cause) {
    throw new VshudBundledRuntimeError(
      'The installed Vshu artifact version is missing or invalid',
      {
        cause
      }
    )
  }
}
