// Unreadable host records must not look absent: deploying over an unknown live install is unsafe.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { removeRemoteFileCommand } from '../../ssh/remote-exec/ssh-remote-commands'
import { execVshudRemote, type VshudRemoteExecTarget } from './vshud-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { isWindowsRemoteHost } from '../../ssh/remote-host/ssh-remote-platform'
import {
  vshudRemoteBaseDir,
  vshudWindowsHostOpCommand,
  readVshudWindowsEncodedAnswer
} from './vshud-remote-windows-node'
import {
  VSHUD_RECORD_ABSENT_MARKER as ABSENT_MARKER,
  VSHUD_RECORD_PRESENT_MARKER as PRESENT_MARKER
} from '../host-state/vshud-windows-host-script'

/** Callers validate the schema of present records. */
type VshudRemoteRecordRead = { state: 'absent' } | { state: 'present'; raw: string }

function windowsBaseDir(target: VshudRemoteExecTarget): string {
  if (!target.remoteHome) {
    throw new Error(
      'vshud host records on Windows need the remote home to find the pinned node.exe'
    )
  }
  return vshudRemoteBaseDir(target.host, target.remoteHome)
}

export async function readBoundedVshudRemoteRecord(
  target: VshudRemoteExecTarget,
  path: string,
  maxBytes: number
): Promise<VshudRemoteRecordRead> {
  if (isWindowsRemoteHost(target.host)) {
    return readWindowsRecord(target, path, maxBytes)
  }
  const file = quotePosixShell(path)
  // Explicit markers distinguish absent records from failed reads with empty stdout.
  const output = await execVshudRemote(
    target,
    `if [ ! -e ${file} ] && [ ! -L ${file} ]; then printf '%s\\n' ${ABSENT_MARKER}; exit 0; fi; ` +
      `[ -f ${file} ] || exit 65; size=$(wc -c < ${file}) || exit 65; ` +
      `[ "$size" -le ${maxBytes} ] || exit 65; ` +
      `printf '%s\\n' ${PRESENT_MARKER}; cat ${file}`
  )
  const newline = output.indexOf('\n')
  const marker = (newline === -1 ? output : output.slice(0, newline)).trim()
  if (marker === ABSENT_MARKER) {
    return { state: 'absent' }
  }
  if (marker !== PRESENT_MARKER) {
    throw new Error('vshud host record read returned no verifiable answer')
  }
  return { state: 'present', raw: newline === -1 ? '' : output.slice(newline + 1) }
}

async function readWindowsRecord(
  target: VshudRemoteExecTarget,
  path: string,
  maxBytes: number
): Promise<VshudRemoteRecordRead> {
  const output = await execVshudRemote(
    target,
    vshudWindowsHostOpCommand(target.host, windowsBaseDir(target), 'record-read', [
      path,
      String(maxBytes)
    ])
  )
  if (output.split(/\r?\n/u).some((line) => line.trim() === ABSENT_MARKER)) {
    return { state: 'absent' }
  }
  const raw = readVshudWindowsEncodedAnswer(output, PRESENT_MARKER)
  if (raw === null) {
    throw new Error('vshud host record read returned no verifiable answer')
  }
  return { state: 'present', raw }
}

export async function writeAtomicVshudRemoteRecord(
  target: VshudRemoteExecTarget,
  path: string,
  contents: string
): Promise<void> {
  const partialPath = `${path}.partial.${process.pid}.${randomUUID()}`
  const baseDir = isWindowsRemoteHost(target.host) ? windowsBaseDir(target) : null
  try {
    if (baseDir) {
      await target.conn.writeFile(partialPath, contents, {
        hostPlatform: target.host,
        signal: target.signal
      })
      await execVshudRemote(
        target,
        vshudWindowsHostOpCommand(target.host, baseDir, 'record-publish', [partialPath, path])
      )
      return
    }
    await execVshudRemote(
      target,
      `umask 077; printf %s ${quotePosixShell(contents)} > ${quotePosixShell(partialPath)} && ` +
        `mv -f ${quotePosixShell(partialPath)} ${quotePosixShell(path)}`
    )
  } catch (error) {
    // Unconfirmed writes may still be running; preserve their partial file.
    if (!isUnconfirmedSshCommandTermination(error)) {
      const discard = baseDir
        ? vshudWindowsHostOpCommand(target.host, baseDir, 'remove-file', [partialPath])
        : removeRemoteFileCommand(target.host, partialPath)
      await execVshudRemote(target, discard).catch(() => {})
    }
    throw error
  }
}
