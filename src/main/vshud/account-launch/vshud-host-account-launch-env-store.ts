// Persist desktop-pushed account environment so launches before reconnect keep the selected account.
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HostAccountLaunchEnvParams,
  type HostAccountLaunchEnv
} from '../../../shared/agent-launch/startup/host-account-launch-env'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import { isWslHostVshudProcess } from '../../wsl/filesystem/wsl-guest-windows-drive-path'
import { createWslHostClaudeProfileRefresh } from './vshud-wsl-host-claude-profile-refresh'

const FILE_NAME = 'host-account-launch-env.json'

export function readVshudHostAccountLaunchEnv(userDataPath: string): HostAccountLaunchEnv | null {
  let raw: string
  try {
    raw = readFileSync(join(userDataPath, FILE_NAME), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = HostAccountLaunchEnvParams.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeVshudHostAccountLaunchEnv(
  userDataPath: string,
  launchEnv: HostAccountLaunchEnv
): void {
  const target = join(userDataPath, FILE_NAME)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(launchEnv), { mode: 0o600 })
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export function restoreVshudHostAccountLaunchEnv(
  runtime: Pick<VshuRuntimeService, 'restoreHostAccountLaunchEnv'>,
  userDataPath: string,
  isWslHost: () => boolean = isWslHostVshudProcess
): void {
  // Why only a WSL host: only there does a desktop push accounts into account folders in this distro.
  const wslHost = isWslHost()
  runtime.restoreHostAccountLaunchEnv(
    readVshudHostAccountLaunchEnv(userDataPath),
    (launchEnv) => writeVshudHostAccountLaunchEnv(userDataPath, launchEnv),
    wslHost
      ? { expectDesktopPush: true, refreshClaudeProfile: createWslHostClaudeProfileRefresh() }
      : {}
  )
}
