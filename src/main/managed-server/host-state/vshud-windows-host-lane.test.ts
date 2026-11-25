// Real Windows SSH host lane: invoke-windows-host-cells.ps1 supplies VSHU_RUN_SSH_WINDOWS_HOST=1 and VSHU_SSH_WINDOWS_HOST_CELL.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { SshConnection } from '../../ssh/connection/ssh-connection'
import {
  connectHostileHost,
  installHostileHostAppEnvironment
} from '../../ssh/hostile-host-test-support/ssh-hostile-host-test-harness'
import { resolveVshudRemoteContext } from '../install/vshud-remote-context'
import { proveWindowsStdioBridge } from '../lifecycle/testing/vshud-windows-stdio-bridge-test-cell'
import { deployVshud } from '../install/vshud-remote-deploy'
import { vshudLivenessProbeCommand, parseVshudLiveness } from '../install/vshud-remote-launch'
import { vshudSlotDir, type VshudSlotOptions } from '../activation/vshud-recovery-slot'
import { decommissionRemoteVshud } from '../install/vshud-remote-decommission'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import { gcOldVshudVersions } from '../install/vshud-remote-gc'
import { execVshudRemote } from '../install/vshud-remote-runtime-control'
import { vshudWindowsNodeCommandLine } from '../install/vshud-remote-windows-node'
import { joinRemotePath } from '../../ssh/remote-host/ssh-remote-platform'
import {
  isWindowsVshudCellId,
  readWindowsHostCellDescriptor,
  windowsHostSshTarget
} from '../../ssh/hostile-host-test-support/ssh-windows-host-cells'

const RUN = process.env.VSHU_RUN_SSH_WINDOWS_HOST === '1'
const CELL_TIMEOUT_MS = 20 * 60_000

/** Host operations must avoid PowerShell hops regardless of sshd DefaultShell. */
function isVshudHostCommand(command: string): boolean {
  return /vshud-host-script-[0-9a-f]{16}\.js|[\\/]vshud\.js /u.test(command)
}

describe.runIf(RUN)('managed vshud on a Windows OpenSSH host', () => {
  let cleanupAppEnvironment: (() => void) | null = null

  beforeAll(() => {
    cleanupAppEnvironment = installHostileHostAppEnvironment()
  })

  afterAll(() => {
    cleanupAppEnvironment?.()
  })

  it(
    'deploys, serves, decommissions by request and exits',
    async () => {
      const descriptor = readWindowsHostCellDescriptor(process.env.VSHU_SSH_WINDOWS_HOST_CELL ?? '')
      if (!isWindowsVshudCellId(descriptor.cell)) {
        throw new Error(`${descriptor.cell} is not a managed vshud cell`)
      }
      const sshTarget = windowsHostSshTarget(descriptor, randomUUID())
      let exec: MockInstance<SshConnection['exec']> | null = null
      const receipt: Record<string, unknown> = { cell: descriptor.cell, target: descriptor.target }
      let conn: SshConnection | null = null
      try {
        conn = await connectHostileHost(sshTarget)
        exec = vi.spyOn(SshConnection.prototype, 'exec')
        const context = await resolveVshudRemoteContext(sshTarget, conn)
        expect(context.host.os).toBe('win32')
        const options: VshudSlotOptions = {
          conn,
          host: context.host,
          remoteHome: context.remoteHome,
          nodePath: 'node',
          userDataDir: context.userDataDir,
          bindHost: '127.0.0.1',
          port: 0
        }
        const idle = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
        const deployed = await deployVshud({
          ...options,
          target: context.serverTarget,
          census: idle,
          recountCensus: async () => idle,
          releaseIncumbentAdmission: async () => {}
        })
        receipt.deploy = deployed
        expect(deployed.outcome).toBe('installed-and-activated')
        const slotDir = vshudSlotDir(options, deployed.fullVersion)
        const liveness = async () =>
          parseVshudLiveness(
            await execVshudRemote(options, vshudLivenessProbeCommand(options.host, slotDir))
          )
        expect(await liveness()).toBe('LIVE')
        // Probe the native vshu launcher installed inside the managed profile.
        const cli = joinRemotePath(options.host, context.userDataDir, 'cli', 'bin', 'vshu.exe')
        const status = JSON.parse(
          await execVshudRemote(options, vshudWindowsNodeCommandLine(cli, ['status', '--json']))
        )
        receipt.cliStatus = status.result
        expect(status.result.runtime).toMatchObject({ reachable: true })
        expect(status.result.app.desktopWindowStatus).toBe('blocked')
        // This account blocks forwarding; verify the managed tunnel's stdio fallback.
        receipt.stdioBridge = await proveWindowsStdioBridge(conn, options.host, slotDir)
        expect(receipt.stdioBridge).toMatchObject({
          forwarding: 'refused',
          response: expect.stringMatching(/^HTTP\/1\.1 101/u)
        })
        const record = await readVshudActivationRecord(options)
        receipt.decommission = await decommissionRemoteVshud({
          ...options,
          record,
          census: { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
        })
        // Include the refusal detail because matcher diffs omit the message.
        expect(receipt.decommission, JSON.stringify(receipt.decommission)).toMatchObject({
          outcome: 'decommissioned',
          version: deployed.fullVersion
        })
        expect(await liveness()).toBe('DEAD')
        await gcOldVshudVersions({
          conn,
          host: options.host,
          remoteHome: options.remoteHome,
          currentDirAbsPath: slotDir,
          record: await readVshudActivationRecord(options)
        })
        expect(await liveness()).toBe('DEAD')

        const commands = exec.mock.calls.map(([command]) => String(command))
        const vshudCommands = commands.filter(isVshudHostCommand)
        receipt.vshudCommands = vshudCommands.length
        receipt.powershellCommands = commands.filter((command) =>
          /^powershell\.exe /iu.test(command)
        ).length
        expect(vshudCommands.length).toBeGreaterThan(0)
        for (const command of vshudCommands) {
          expect(command).not.toMatch(/EncodedCommand/u)
        }
        receipt.passed = true
      } finally {
        exec?.mockRestore()
        await conn?.disconnect().catch(() => {})
        writeFileSync(descriptor.receipt, `${JSON.stringify(receipt, null, 2)}\n`)
      }
    },
    CELL_TIMEOUT_MS
  )
})
