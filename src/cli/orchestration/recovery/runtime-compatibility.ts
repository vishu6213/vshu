import { basename } from 'node:path'
import { RuntimeClientError } from '../../runtime/connection/types'

export function resolveCompatibilityCliCommand(): 'vshu' | 'vshu-ide' | 'vshu-dev' {
  const configured = process.env.VSHU_CLI_COMMAND
  if (configured === 'vshu' || configured === 'vshu-ide' || configured === 'vshu-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'vshu-ide' : 'vshu'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'vshu' | 'vshu-ide' | undefined {
  if (process.env.VSHU_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.VSHU_CLI_COMMAND
  if (command === 'vshu' || command === 'vshu-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Vshu launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.VSHU_DEV_CLI_INVOCATION === '1' ||
    (process.env.VSHU_USER_DATA_PATH?.includes('vshu-dev') ?? false)
  )
}

// Linux desktop installs the app CLI as `vshu-ide` (GNOME's screen reader owns `vshu`), while
// Vshu terminals advertise their shim via VSHU_CLI_COMMAND, dev launchers are `vshu-dev`, and
// SSH/headless Node CLIs stay `vshu`.
export function resolveInvokedCliCommand(): string {
  if (process.platform !== 'linux') {
    return 'vshu'
  }
  const configured = process.env.VSHU_CLI_COMMAND?.trim()
  if (configured) {
    return basename(configured)
  }
  if (isDevCliInvocation()) {
    return 'vshu-dev'
  }
  return process.env.ELECTRON_RUN_AS_NODE === '1' ? 'vshu-ide' : 'vshu'
}
