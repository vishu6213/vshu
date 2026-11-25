import { access, mkdir, open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import {
  setRuntimeBrowserUnavailableCause,
  type RuntimeBrowserCommandsFactory,
  type RuntimeBrowserIdentity,
  type RuntimeBrowserUnavailableCause
} from '../../runtime/browser/installation/runtime-browser-commands-factory'
import { ExternalChromiumBrowserProcess } from './chromium/external-chromium-browser-process'
import type { ExternalChromiumLaunch } from './chromium/external-chromium-browser-session'
import { resolveVshudAgentBrowserBinary } from './vshud-agent-browser-binary'
import { ElectronServeBrowserProcess } from './electron/electron-serve-browser-process'
import { electronSidecarIdentity } from './electron/electron-sidecar-identity'
import { watchVshudBrowserInstallPark } from './vshud-browser-install-park'
import { openServeBundlePark } from '../../../shared/remote-runtime/serve-supervisor/serve-bundle-park'
import { VSHUD_BROWSER_PARK_LABEL } from '../../../shared/remote-runtime/serve-supervisor/serve-bundle-coordination'
import { errorMessage } from '../../../shared/errors/error-message'
import { VSHU_SERVE_APPIMAGE_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-server-launch-env'

export type VshudBrowserProvider = {
  kind: 'electron' | 'chromium'
  factory: RuntimeBrowserCommandsFactory
  isAvailable(): boolean
  /** Engine-served capabilities, such as the cookie clears, that an older browser engine lacks. */
  supportsEngineCapability?(capability: string): boolean
  identity?(): RuntimeBrowserIdentity | null
  stop(): Promise<void>
}

export type VshudBrowserProviderOptions = {
  userDataPath: string
  signal?: AbortSignal
  environment?: NodeJS.ProcessEnv
  resolveInstalledElectronExecutable?: () => Promise<string | null>
  resolveAgentBrowserBinary?: () => string | null
}

type ExecutableProbe = 'ok' | 'missing' | 'not_executable'

class VshudBrowserCleanupError extends AggregateError {}

async function cleanupFailedProvider(
  processHandle: { stop(): Promise<void> },
  startupError: unknown
): Promise<never> {
  try {
    await processHandle.stop()
  } catch (cleanupError) {
    throw new VshudBrowserCleanupError([startupError, cleanupError], 'vshud_browser_cleanup_failed')
  }
  throw startupError
}

async function probeExecutable(path: string): Promise<ExecutableProbe> {
  const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK
  try {
    await access(path, mode)
    return 'ok'
  } catch {
    if (mode === constants.F_OK) {
      return 'missing'
    }
  }
  try {
    await access(path, constants.F_OK)
    return 'not_executable'
  } catch {
    return 'missing'
  }
}

async function executableExists(path: string): Promise<boolean> {
  return (await probeExecutable(path)) === 'ok'
}

export function installedElectronCandidates(
  platform: NodeJS.Platform,
  homePath: string,
  environment: NodeJS.ProcessEnv
): string[] {
  const joinPath = platform === 'win32' ? win32.join : posix.join
  if (platform === 'darwin') {
    return [
      '/Applications/Vshu.app/Contents/MacOS/Vshu',
      joinPath(homePath, 'Applications', 'Vshu.app', 'Contents', 'MacOS', 'Vshu')
    ]
  }
  if (platform === 'win32') {
    return [
      ...(environment.LOCALAPPDATA
        ? [joinPath(environment.LOCALAPPDATA, 'Programs', 'Vshu', 'Vshu.exe')]
        : []),
      ...(environment.ProgramFiles ? [joinPath(environment.ProgramFiles, 'Vshu', 'Vshu.exe')] : [])
    ]
  }
  const servedAppImage = environment[VSHU_SERVE_APPIMAGE_ENV]
  return [
    joinPath(homePath, '.local', 'bin', 'vshu-ide'),
    '/usr/local/bin/vshu-ide',
    '/usr/bin/orca-ide',
    '/opt/Vshu/vshu-ide',
    // Last: hosts where an installer copy already works keep it.
    ...(servedAppImage && posix.isAbsolute(servedAppImage) ? [servedAppImage] : [])
  ]
}

async function isScriptShim(path: string): Promise<boolean> {
  try {
    const handle = await open(await realpath(path), 'r')
    try {
      const head = Buffer.alloc(2)
      const { bytesRead } = await handle.read(head, 0, 2, 0)
      return bytesRead === 2 && head[0] === 0x23 && head[1] === 0x21
    } finally {
      await handle.close()
    }
  } catch {
    return true
  }
}

/** Require installer-owned paths or the AppImage serve runs from; never guess other AppImage locations. */
export async function resolveInstalledElectronExecutable(
  candidates: string[] = installedElectronCandidates(process.platform, homedir(), process.env)
): Promise<string | null> {
  for (const candidate of candidates) {
    if ((await executableExists(candidate)) && !(await isScriptShim(candidate))) {
      return candidate
    }
  }
  return null
}

async function startProvider(
  agentBrowserPath: string,
  launch: ExternalChromiumLaunch,
  userDataPath: string,
  signal?: AbortSignal
): Promise<VshudBrowserProvider> {
  const processHandle = new ExternalChromiumBrowserProcess(agentBrowserPath, launch, userDataPath)
  try {
    await processHandle.start(signal)
  } catch (error) {
    return cleanupFailedProvider(processHandle, error)
  }
  return {
    kind: launch.provider,
    factory: (host) => processHandle.createCommands(host),
    isAvailable: () => processHandle.isAvailable(),
    stop: () => processHandle.stop()
  }
}

async function startElectronServeProvider(
  executablePath: string,
  userDataPath: string,
  signal?: AbortSignal
): Promise<VshudBrowserProvider> {
  const processHandle = new ElectronServeBrowserProcess(executablePath, userDataPath)
  // Only helpers launched from macOS app bundles register.
  const park = openServeBundlePark({ executable: executablePath, label: VSHUD_BROWSER_PARK_LABEL })
  // Launching the bundle ShipIt is replacing aborts the install; the watcher starts it once the hold ends.
  const parked = park?.holds() ?? false
  if (!parked) {
    try {
      await processHandle.start(signal)
    } catch (error) {
      return cleanupFailedProvider(processHandle, error)
    }
  }
  const helper = {
    pid: () => processHandle.pid(),
    stop: () => processHandle.stop(),
    start: async (restartSignal: AbortSignal) => {
      try {
        await processHandle.start(restartSignal)
      } catch (error) {
        await processHandle.stop()
        throw error
      }
    }
  }
  const installPark = park ? watchVshudBrowserInstallPark(helper, { park, parked }) : null
  return {
    kind: 'electron',
    supportsEngineCapability: (capability) => processHandle.sidecarWith(capability) !== null,
    identity: () => electronSidecarIdentity(processHandle),
    factory: (host) => processHandle.createCommands(host),
    isAvailable: () => processHandle.isAvailable(),
    stop: async () => {
      await installPark?.close()
      await processHandle.stop()
    }
  }
}

export async function resolveVshudBrowserProvider(
  options: VshudBrowserProviderOptions
): Promise<VshudBrowserProvider | null> {
  const environment = options.environment ?? process.env
  if (options.signal?.aborted) {
    return null
  }
  await mkdir(options.userDataPath, { recursive: true, mode: 0o700 })

  const declined = (cause: RuntimeBrowserUnavailableCause): null => {
    setRuntimeBrowserUnavailableCause(cause)
    return null
  }

  const installedElectronExecutable = await (
    options.resolveInstalledElectronExecutable ?? resolveInstalledElectronExecutable
  )()
  if (options.signal?.aborted) {
    return null
  }
  // Defer Electron failure: configured Chromium may succeed or provide a more actionable cause.
  let electronFailure: RuntimeBrowserUnavailableCause | null = null
  if (installedElectronExecutable) {
    try {
      setRuntimeBrowserUnavailableCause(null)
      return await startElectronServeProvider(
        installedElectronExecutable,
        options.userDataPath,
        options.signal
      )
    } catch (error) {
      if (error instanceof VshudBrowserCleanupError) {
        throw error
      }
      if (options.signal?.aborted) {
        return null
      }
      console.warn('[vshud] Installed Electron browser provider unavailable:', error)
      electronFailure = { reason: 'electron_start_failed', detail: errorMessage(error) }
    }
  }

  // Read configuration before probing drivers so missing drivers cannot look like missing configuration.
  const chromiumExecutable = environment.VSHU_BROWSER_EXECUTABLE?.trim()
  if (!chromiumExecutable) {
    return declined(electronFailure ?? { reason: 'unconfigured' })
  }

  const agentBrowserPath = (options.resolveAgentBrowserBinary ?? resolveVshudAgentBrowserBinary)()
  if (!agentBrowserPath) {
    return declined({ reason: 'driver_missing' })
  }

  const probe = await probeExecutable(chromiumExecutable)
  if (options.signal?.aborted) {
    return null
  }
  if (probe !== 'ok') {
    return declined({
      reason: probe === 'missing' ? 'executable_not_found' : 'executable_not_executable',
      detail: chromiumExecutable
    })
  }

  try {
    setRuntimeBrowserUnavailableCause(null)
    return await startProvider(
      agentBrowserPath,
      { executablePath: chromiumExecutable, provider: 'chromium' },
      options.userDataPath,
      options.signal
    )
  } catch (error) {
    if (error instanceof VshudBrowserCleanupError) {
      throw error
    }
    if (options.signal?.aborted) {
      return null
    }
    console.warn('[vshud] External Chromium browser provider unavailable:', error)
    return declined({ reason: 'chromium_start_failed', detail: errorMessage(error) })
  }
}
