// Run app-side to keep materializers out of the CLI bundle. Prefer a userData vshud slot;
// unsupported packaging/runtime/native conditions fall back to Electron with a diagnostic.
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runProcess } from '@vshu/process-host'
import {
  NODE_RUNTIME_ASSETS,
  type ServerTarget
} from '../../../shared/node-runtime/node-runtime-pin'
import {
  VSHUD_SERVER_ENTRY_FILENAME,
  VSHUD_VERSION_FILENAME,
  vshudNodeRuntimeRelativePath
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import {
  VSHUD_NATIVE_PREFLIGHT_FLAG,
  parseVshudNativePreflightReport
} from '../../../shared/remote-runtime/vshud-distribution/vshud-native-preflight-report'
import {
  SERVE_RUNTIME_ELECTRON,
  SERVE_RUNTIME_ENV,
  type ServeRuntimeSelection
} from '../../../shared/remote-runtime/serve-supervisor/vshud-local-serve-selection'
import { resolveBundledVshudRuntime } from '../runtime-launch/vshud-bundled-runtime'
import { detectNativeHostAbi, nativeSlotName } from '../native-runtime/native-host-abi'
import { materializeVshudArtifact } from '../artifact-slots/vshud-artifact-materializer'
import { materializeCachedNodeRuntime } from '../../node-runtime/pinned-runtime-materializer'
import {
  copyVerifiedAppImageNodeRuntime,
  type AppImageNodeRuntime
} from '../../node-runtime/appimage-bundled-node-runtime'
import { serveProfileHasSshTargets } from '../profile-state/serve-profile-ssh-targets'
import { errorMessage } from '../../../shared/errors/error-message'

const NATIVE_PREFLIGHT_TIMEOUT_MS = 30_000

export type ServeRuntimeSelectionInput = {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  userDataPath: string
  templateDirs: readonly string[]
  hostTarget?: () => string
  materializeSlot?: typeof materializeVshudArtifact
  materializeRuntime?: typeof materializeCachedNodeRuntime
  /** Try the AppImage’s pinned Node before downloading. */
  bundledNodeRuntime?: AppImageNodeRuntime | null
  nativePreflight?: (runtime: string, entry: string) => Promise<string>
  profileHasSshTargets?: (userDataPath: string) => boolean
}

function isServerTarget(value: string): value is ServerTarget {
  return Object.keys(NODE_RUNTIME_ASSETS).includes(value)
}

function electron(reason: string): ServeRuntimeSelection {
  return { kind: 'electron', reason }
}

export async function selectServeRuntime(
  input: ServeRuntimeSelectionInput
): Promise<ServeRuntimeSelection> {
  const requested = input.env[SERVE_RUNTIME_ENV]
  if (requested === SERVE_RUNTIME_ELECTRON) {
    return { kind: 'electron', reason: null }
  }
  if (requested && requested !== 'vshud') {
    return electron(`${SERVE_RUNTIME_ENV}=${requested} is neither vshud nor electron`)
  }
  // Default to Electron for SSH targets until vshud supports them; explicit vshud selection overrides.
  const sshReason = requested ? null : profileSshReason(input)
  if (sshReason) {
    return electron(sshReason)
  }
  const target = (input.hostTarget ?? (() => nativeSlotName(detectNativeHostAbi())))()
  if (!isServerTarget(target)) {
    return electron(`no vshud build exists for this host (${target})`)
  }
  const templateDir = input.templateDirs.find((candidate) => existsSync(candidate))
  if (!templateDir) {
    return electron('this Vshu install carries no vshud template')
  }
  const cacheRoot = join(input.userDataPath, 'vshud-artifacts')
  let slotDir: string
  try {
    slotDir = await (input.materializeSlot ?? materializeVshudArtifact)(target, {
      templateDir,
      cacheRoot
    })
    await placeSlotRuntime(slotDir, target, cacheRoot, input)
  } catch (error) {
    return electron(`the vshud slot for ${target} could not be prepared: ${errorMessage(error)}`)
  }
  let runtime: string | null
  try {
    runtime = resolveBundledVshudRuntime(slotDir)
  } catch (error) {
    return electron(`the vshud slot is incomplete: ${errorMessage(error)}`)
  }
  if (!runtime) {
    return electron('the vshud slot names no pinned runtime')
  }
  const entry = join(slotDir, VSHUD_SERVER_ENTRY_FILENAME)
  const report = parseVshudNativePreflightReport(
    await (input.nativePreflight ?? runNativePreflight)(runtime, entry).catch(() => '')
  )
  if (!report) {
    return electron('vshud did not answer its native preflight')
  }
  if (report.status === 'blocked' || report.status === 'degraded') {
    return electron(
      `vshud cannot run terminals here (${report.status}: ${report.reason ?? 'unknown'})`
    )
  }
  return {
    kind: 'vshud',
    runtime,
    entry,
    version: readFileSync(join(slotDir, VSHUD_VERSION_FILENAME), 'utf8').trim()
  }
}

function profileSshReason(input: ServeRuntimeSelectionInput): string | null {
  try {
    return (input.profileHasSshTargets ?? serveProfileHasSshTargets)(input.userDataPath)
      ? 'this profile has SSH targets, which vshud cannot serve yet'
      : null
  } catch (error) {
    // Unknown/old-schema profiles may contain saved SSH targets; preserve Electron reachability.
    return `could not tell whether this profile has SSH targets, which vshud cannot serve yet (${errorMessage(error)})`
  }
}

async function placeSlotRuntime(
  slotDir: string,
  target: ServerTarget,
  cacheRoot: string,
  {
    materializeRuntime = materializeCachedNodeRuntime,
    bundledNodeRuntime
  }: Pick<ServeRuntimeSelectionInput, 'materializeRuntime' | 'bundledNodeRuntime'>
): Promise<void> {
  const destination = join(
    slotDir,
    ...vshudNodeRuntimeRelativePath(target, NODE_RUNTIME_ASSETS[target].executableSha256)
  )
  if (existsSync(destination)) {
    return
  }
  if (bundledNodeRuntime?.target === target) {
    try {
      await copyVerifiedAppImageNodeRuntime(bundledNodeRuntime, destination)
      return
    } catch (error) {
      console.error(`vshu serve: not using the bundled Node (${errorMessage(error)})`)
    }
  }
  const cached = await materializeRuntime(target, cacheRoot, { fetcher: fetch })
  mkdirSync(dirname(destination), { recursive: true })
  try {
    linkSync(cached, destination)
  } catch {
    copyFileSync(cached, destination)
    chmodSync(destination, 0o755)
  }
}

async function runNativePreflight(runtime: string, entry: string): Promise<string> {
  const result = await runProcess({
    program: runtime,
    args: [entry, VSHUD_NATIVE_PREFLIGHT_FLAG],
    timeoutMs: NATIVE_PREFLIGHT_TIMEOUT_MS
  })
  return result.stdout
}
