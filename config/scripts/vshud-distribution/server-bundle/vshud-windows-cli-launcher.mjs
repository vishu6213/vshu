import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runProcessSync } from '@vshu/process-host'
import { VSHUD_WINDOWS_CLI_LAUNCHER_FILENAME } from '../../../../src/shared/remote-runtime/vshud-distribution/vshud-artifacts.ts'

const { PE_MACHINE, describePeMachine, readPeMachine } = createRequire(import.meta.url)(
  '../../native-build/windows/windows-pe-machine.cjs'
)

export function vshudWindowsCliLauncherSource(root, arch) {
  return join(root, '.build', 'windows-cli-launcher', arch, 'vshu.exe')
}

/** A Windows slot's `vshu` command; a Windows build host compiles a missing one. */
export function stageVshudWindowsCliLauncher(
  root,
  outputDir,
  target,
  host = { platform: process.platform },
  compile = compileVshudWindowsCliLauncher
) {
  if (!target.startsWith('win32-')) {
    return
  }
  const arch = target.slice('win32-'.length)
  const source = vshudWindowsCliLauncherSource(root, arch)
  if (!existsSync(source)) {
    if (host.platform !== 'win32') {
      throw new Error(
        `Vshud ${target} requires the native CLI launcher. On Windows, run: ` +
          `node config/scripts/native-build/windows/build-windows-cli-launcher.mjs --arch ${arch} --output ${source}`
      )
    }
    compile(root, arch, source)
  }
  const machine = readPeMachine(source)
  if (machine !== PE_MACHINE[arch]) {
    throw new Error(`Vshud ${target} CLI launcher has ${describePeMachine(machine)}`)
  }
  const destination = join(outputDir, ...VSHUD_WINDOWS_CLI_LAUNCHER_FILENAME.split('/'))
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

function compileVshudWindowsCliLauncher(root, arch, output) {
  const result = runProcessSync({
    program: process.execPath,
    args: [
      join(root, 'config/scripts/native-build/windows/build-windows-cli-launcher.mjs'),
      '--arch',
      arch,
      '--output',
      output
    ],
    cwd: root,
    stdio: 'inherit',
    timeoutMs: null
  })
  if (result.code !== 0) {
    throw new Error(`Windows CLI launcher build for ${arch} failed with exit ${result.code}`)
  }
}
