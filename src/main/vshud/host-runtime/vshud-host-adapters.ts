import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { VSHUD_CLI_PACKAGE_FILENAME } from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import {
  setAppEnvironment,
  type AppEnvironment
} from '../../../shared/app-lifecycle/app-environment'
import { createNodeServiceEnvironment } from '../../backend/node-service-environment'
import { setSecretStore } from '../../../shared/secure-storage/secret-store'
import { resolveVshudInstallRoot, resolveVshudPath } from './vshud-app-paths'
import { getVshudCliLauncherPath } from '../serve-startup/vshud-cli-launcher'
import { createVshudSecretStore, type VshudSecretStore } from '../credentials/vshud-secret-store'
import { setSpeechServiceFactories } from '../../speech/speech-runtime-service'
import { vshudSpeechServiceFactories } from './vshud-speech-services'

let quitRegisteredHandlers = (): void => {}

export function runVshudQuitHandlers(): void {
  quitRegisteredHandlers()
}

function createNodeAppEnvironment(): AppEnvironment {
  const host = createNodeServiceEnvironment({
    getPath: resolveVshudPath,
    getAppPath: () => resolveVshudInstallRoot(),
    getVersion: () => process.env.VSHU_VERSION ?? '0.0.0-vshud',
    isPackaged: () => true,
    getCliLauncherPath: getVshudCliLauncherPath
  })
  quitRegisteredHandlers = host.runQuitHandlers
  return host.environment
}

let vshudSecretStore: VshudSecretStore | null = null

export async function prepareVshudSecretStore(
  keyDir: string,
  userDataPath: string
): Promise<boolean> {
  if (!vshudSecretStore) {
    throw new Error('vshud_secret_store_not_installed — call installVshudHostAdapters() first')
  }
  return vshudSecretStore.prepare({ keyDir, userDataPath })
}

/** Stamp the bundle’s own release so inherited desktop versions cannot misidentify this server. */
export function stampVshudAppVersion(installRoot: () => string = resolveVshudInstallRoot): void {
  let version: unknown
  try {
    const path = join(installRoot(), ...VSHUD_CLI_PACKAGE_FILENAME.split('/'))
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    version = parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : null
  } catch {
    return
  }
  if (typeof version === 'string' && version.length > 0) {
    process.env.VSHU_APP_VERSION = version
  }
}

export function installVshudHostAdapters(): void {
  stampVshudAppVersion()
  setAppEnvironment(createNodeAppEnvironment())
  vshudSecretStore = createVshudSecretStore()
  setSecretStore(vshudSecretStore)
  setSpeechServiceFactories(vshudSpeechServiceFactories)
}
