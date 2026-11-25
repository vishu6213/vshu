import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElectronHomeIsolation } from '../electron-fixtures/electron-home-isolation'

const execFileAsync = promisify(execFile)
const RUNTIME_METADATA_FILE = 'vshu-runtime.json'
let vshuDevUserDataPath: string | null = null
let vshuServeProcess: ChildProcess | null = null
let vshuServeStdout = ''
let vshuServeStderr = ''

export type CliResult = {
  stdout: string
  stderr: string
}

type RunVshuCliOptions = {
  retryMissingRuntimeMetadata?: boolean
}

export async function runVshuCli(
  args: string[],
  options: RunVshuCliOptions = {}
): Promise<CliResult> {
  try {
    return await runVshuCliOnce(args)
  } catch (error) {
    if (
      options.retryMissingRuntimeMetadata !== false &&
      isMissingRuntimeMetadataError(args, error)
    ) {
      // Windows can lose the dev runtime while launching the fixture app; reopen once before the desktop action.
      await ensureVshuRuntimeLaunched()
      return await runVshuCliOnce(args)
    }
    throw error
  }
}

async function runVshuCliOnce(args: string[]): Promise<CliResult> {
  const devCli = join(process.cwd(), 'config/scripts/development/launch/vshu-dev.mjs')
  const command = process.env.VSHU_COMPUTER_CLI ?? process.execPath
  const cliArgs = process.env.VSHU_COMPUTER_CLI ? args : [devCli, ...args]
  const env = process.env.VSHU_COMPUTER_CLI
    ? { ...process.env }
    : await createComputerE2ERuntimeEnv()
  try {
    const result = await execFileAsync(command, cliArgs, {
      env,
      maxBuffer: 20 * 1024 * 1024
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const output = error as { message: string; stdout: string; stderr: string }
      throw new Error(`${output.message}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
    }
    throw error
  }
}

export async function ensureVshuRuntimeLaunched(): Promise<void> {
  if (!process.env.VSHU_COMPUTER_CLI && process.platform === 'win32') {
    await ensureVshuRuntimeServed()
    return
  }
  await runVshuCli(['open', '--json'], { retryMissingRuntimeMetadata: false })
  await waitForVshuRuntimeReady()
}

export async function stopVshuRuntime(): Promise<void> {
  const processToStop = vshuServeProcess
  if (!processToStop?.pid) {
    return
  }
  vshuServeProcess = null
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'])
    } catch {
      // The foreground test runtime may already have exited.
    }
    return
  }
  processToStop.kill()
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

async function getComputerE2eVshuDevUserDataPath(): Promise<string> {
  if (!vshuDevUserDataPath) {
    // Use a fresh profile so a retained dev runtime cannot execute stale provider code.
    vshuDevUserDataPath = await mkdtemp(join(tmpdir(), 'vshu-computer-runtime-'))
  }
  return vshuDevUserDataPath
}

async function waitForVshuRuntimeReady(): Promise<void> {
  const userDataPath = await getComputerE2eVshuDevUserDataPath()
  const metadataPath = join(userDataPath, RUNTIME_METADATA_FILE)
  const deadline = Date.now() + 15000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await access(metadataPath)
      const status = parseJsonOutput<{
        result: { runtime: { reachable: boolean } }
      }>((await runVshuCli(['status', '--json'], { retryMissingRuntimeMetadata: false })).stdout)
      if (status.result.runtime.reachable) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  const detail = [
    lastError instanceof Error ? `Last error: ${lastError.message}` : null,
    vshuServeStdout.trim() ? `serve stdout: ${vshuServeStdout.trim()}` : null,
    vshuServeStderr.trim() ? `serve stderr: ${vshuServeStderr.trim()}` : null
  ]
    .filter(Boolean)
    .join(' ')
  throw new Error(`Vshu runtime metadata was not ready at ${metadataPath}.${detail}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureVshuRuntimeServed(): Promise<void> {
  if (!vshuServeProcess || vshuServeProcess.exitCode !== null) {
    const devCli = join(process.cwd(), 'config/scripts/development/launch/vshu-dev.mjs')
    const env = await createComputerE2ERuntimeEnv()
    vshuServeStdout = ''
    vshuServeStderr = ''
    vshuServeProcess = spawn(process.execPath, [devCli, 'serve', '--no-pairing', '--json'], {
      env,
      windowsHide: true
    })
    vshuServeProcess.stdout?.on('data', (chunk) => {
      vshuServeStdout += String(chunk)
    })
    vshuServeProcess.stderr?.on('data', (chunk) => {
      vshuServeStderr += String(chunk)
    })
    vshuServeProcess.once('exit', () => {
      vshuServeProcess = null
    })
    process.once('exit', () => {
      vshuServeProcess?.kill()
    })
  }
  await waitForVshuRuntimeReady()
}

async function createComputerE2ERuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const userDataDir =
    process.env.VSHU_DEV_USER_DATA_PATH ?? (await getComputerE2eVshuDevUserDataPath())
  // Strip ELECTRON_RUN_AS_NODE or the Electron child runs as plain Node.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  return {
    ...isolation.env,
    // Keep CLI and Electron on the same runtime metadata while fixture HOME/Codex isolation remains in force.
    VSHU_DEV_USER_DATA_PATH: userDataDir
  }
}

function isMissingRuntimeMetadataError(args: string[], error: unknown): boolean {
  if (args[0] !== 'computer') {
    return false
  }
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false
  }
  const message = String((error as { message?: unknown }).message)
  return (
    message.includes('"code": "runtime_unavailable"') &&
    message.includes('Could not read Vshu runtime metadata')
  )
}
