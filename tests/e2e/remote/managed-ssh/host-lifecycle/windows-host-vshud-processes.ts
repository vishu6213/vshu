// Observe the Windows host-cell account locally: the runner provisioned it and its sshd listens on loopback.
import path from 'node:path'
import { runProcess } from '@vshu/process-host'

export type HostProcess = { pid: number; commandLine: string }

const POWERSHELL = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

// Why ExecutablePath: vshud runs on the pinned node.exe staged under the account's home.
const LIST_SCRIPT =
  "$h=$env:VSHU_E2E_HOST_HOME.TrimEnd('\\','/')+'\\';" +
  '@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($h,[StringComparison]::OrdinalIgnoreCase)} | ForEach-Object {@{pid=[int]$_.ProcessId;commandLine=[string]$_.CommandLine}}) | ConvertTo-Json -Compress -Depth 3'

async function powershell(script: string, home: string): Promise<string> {
  const result = await runProcess({
    program: POWERSHELL,
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    env: { ...process.env, VSHU_E2E_HOST_HOME: home.replaceAll('/', '\\') },
    timeoutMs: 60_000
  })
  if (result.code !== 0) {
    throw new Error(`Host process query failed (${result.code}): ${result.stderr.slice(0, 2_000)}`)
  }
  return result.stdout.trim()
}

export async function listHostAccountProcesses(home: string): Promise<HostProcess[]> {
  const text = await powershell(LIST_SCRIPT, home)
  if (!text) {
    return []
  }
  const parsed: unknown = JSON.parse(text)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row) =>
    row && typeof row.pid === 'number'
      ? [{ pid: row.pid, commandLine: String(row.commandLine ?? '') }]
      : []
  )
}

export async function listHostVshudProcesses(home: string): Promise<HostProcess[]> {
  return (await listHostAccountProcesses(home)).filter((entry) => /vshud/iu.test(entry.commandLine))
}

/** The vshud server itself, without the terminal daemon and workers it forks from the same slot. */
export async function listHostVshudServerProcesses(home: string): Promise<HostProcess[]> {
  return (await listHostVshudProcesses(home)).filter((entry) =>
    /[\\/]vshud(?:-server)?\.js(?=["\s]|$)/iu.test(entry.commandLine)
  )
}

/** Hard-kills the account's vshud server, as a crash would; its terminal daemon keeps running. */
export async function killHostVshud(home: string): Promise<HostProcess[]> {
  const victims = await listHostVshudServerProcesses(home)
  if (victims.length > 0) {
    await powershell(
      `Stop-Process -Force -ErrorAction SilentlyContinue -Id ${victims.map((entry) => entry.pid).join(',')}`,
      home
    )
  }
  return victims
}
