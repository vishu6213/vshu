import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  VSHUD_CLI_ENTRY_FILENAME,
  VSHUD_WINDOWS_CLI_LAUNCHER_FILENAME
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import { nodeFileContentsEqual } from '../../../shared/file-content/node-file-content-equality'
import { buildUnixCliLauncher } from '../../cli/launchers/cli-dev-launcher'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { resolveVshudInstallRoot, resolveUserDataPath } from '../host-runtime/vshud-app-paths'

// The native Windows launcher selects server mode when this sibling config exists.
export const VSHUD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME = 'vshu-launcher.cfg'
const RETIRED_LAUNCHER_SUFFIX = '.retired'

let launcherPath: string | null = null

export function getVshudCliLauncherPath(): string | null {
  return launcherPath
}

export async function prepareVshudCliLauncher(): Promise<void> {
  launcherPath = null
  const installRoot = resolveVshudInstallRoot()
  const entry = join(installRoot, ...VSHUD_CLI_ENTRY_FILENAME.split('/'))
  // Older slots and source-only runs may lack the CLI.
  if (!existsSync(entry)) {
    return
  }
  const userDataPath = resolveUserDataPath()
  const binDir = join(userDataPath, 'cli', 'bin')
  if (process.platform === 'win32') {
    launcherPath = await prepareWindowsLauncher(installRoot, entry, userDataPath, binDir)
    return
  }
  const script = buildUnixCliLauncher(process.execPath, entry, userDataPath, 'node')
  await mkdir(binDir, { recursive: true })
  // Older clients type the Linux desktop `vshu-ide claude-teams` into server terminals.
  const names = process.platform === 'linux' ? ['vshu', 'vshu-ide'] : ['vshu']
  for (const name of names) {
    const path = join(binDir, name)
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current !== script) {
      writeFileAtomically(path, script, { mode: 0o700 })
    }
    await chmod(path, 0o700)
  }
  launcherPath = join(binDir, 'vshu')
}

export function buildWindowsCliLauncherConfig(
  nodePath: string,
  cliEntryPath: string,
  userDataPath: string
): string {
  return `node=${nodePath}\ncli=${cliEntryPath}\nuser-data=${userDataPath}\n`
}

/** Native exe preserves arguments that cmd.exe reparses through batch %*. */
async function prepareWindowsLauncher(
  installRoot: string,
  entry: string,
  userDataPath: string,
  binDir: string
): Promise<string | null> {
  const source = join(installRoot, ...VSHUD_WINDOWS_CLI_LAUNCHER_FILENAME.split('/'))
  if (!existsSync(source)) {
    return null
  }
  const path = join(binDir, 'vshu.exe')
  await mkdir(binDir, { recursive: true })
  await removeRetiredLaunchers(binDir)
  const binary = await readFile(source)
  if (!(await nodeFileContentsEqual(path, binary).catch(() => false))) {
    try {
      writeFileAtomically(path, binary)
    } catch {
      // Windows locks running images against overwrite but allows retirement by rename.
      await rename(path, `${path}.${randomUUID()}${RETIRED_LAUNCHER_SUFFIX}`)
      writeFileAtomically(path, binary)
    }
  }
  const configPath = join(binDir, VSHUD_WINDOWS_CLI_LAUNCHER_CONFIG_FILENAME)
  const config = buildWindowsCliLauncherConfig(process.execPath, entry, userDataPath)
  if ((await readFile(configPath, 'utf8').catch(() => null)) !== config) {
    writeFileAtomically(configPath, config)
  }
  return path
}

async function removeRetiredLaunchers(binDir: string): Promise<void> {
  const names = await readdir(binDir).catch(() => [])
  await Promise.all(
    names
      .filter((name) => name.startsWith('vshu.exe.') && name.endsWith(RETIRED_LAUNCHER_SUFFIX))
      // Running retired images remain until a later cleanup.
      .map((name) => rm(join(binDir, name), { force: true }).catch(() => {}))
  )
}
