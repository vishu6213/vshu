import process from 'node:process'
import { startBackendCore } from '../../backend/core-runtime'
import { resolveUserDataPath } from './vshud-app-paths'
import { prepareVshudCliLauncher } from '../serve-startup/vshud-cli-launcher'
import { installVshudHostAdapters, runVshudQuitHandlers } from './vshud-host-adapters'
import { prepareVshudSecretStoreAndMigrate } from '../credentials/vshud-secret-store-startup'
import type { VshudHandle, VshudOptions } from '../serve-startup/vshud-start-contract'
import { stampRuntimeSourceEnv } from '../../../shared/remote-runtime/host-catalog/runtime-source-env'
import { VSHU_SERVE_SUPERVISED_ENV } from '../../../shared/remote-runtime/serve-supervisor/serve-supervised-terminal-durability'

/** Resolve after transport readiness publishes the desktop-compatible serve payload. */
export async function startVshud(options: VshudOptions = {}): Promise<VshudHandle> {
  installVshudHostAdapters()
  // Inherited terminal identity must not fence vshud’s CLI children to the launching desktop.
  stampRuntimeSourceEnv(process.env, null)
  const userDataPath = resolveUserDataPath()
  // Override inherited data roots so CLI-shared Codex homes resolve on this host.
  process.env.VSHU_USER_DATA_PATH = userDataPath
  return startBackendCore({
    userDataPath,
    supervised: process.env[VSHU_SERVE_SUPERVISED_ENV] === '1',
    options,
    prepareCliLauncher: prepareVshudCliLauncher,
    prepareSecrets: prepareVshudSecretStoreAndMigrate,
    runQuitHandlers: runVshudQuitHandlers
  })
}
