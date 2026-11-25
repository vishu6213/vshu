import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractEmbeddedSevenZip,
  shouldUseUpstreamReleaseAddons
} from './upstream-release-windows-addons.mjs'

const directories = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), 'vshu-upstream-addons-test-'))
  directories.push(directory)
  return directory
}

function sevenZip(body) {
  const header = Buffer.alloc(32)
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]).copy(header)
  header.writeBigUInt64LE(BigInt(body.length - 4), 12)
  header.writeBigUInt64LE(4n, 20)
  header.writeUInt32LE(crc32(header.subarray(12, 32)), 8)
  return Buffer.concat([header, body])
}

describe('extractEmbeddedSevenZip', () => {
  it('cuts the checksummed archive out of the installer stub', () => {
    const directory = scratch()
    const archive = sevenZip(Buffer.from('payload-bytes'))
    // A bare signature without a valid start header must be skipped, not cut.
    const decoy = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4, 1, 2, 3])
    const installer = Buffer.concat([Buffer.from('MZ-stub'), decoy, archive, Buffer.from('tail')])
    writeFileSync(join(directory, 'setup.exe'), installer)

    extractEmbeddedSevenZip(join(directory, 'setup.exe'), join(directory, 'out.7z'))

    expect(readFileSync(join(directory, 'out.7z')).equals(archive)).toBe(true)
  })

  it('rejects an installer without a payload', () => {
    const directory = scratch()
    writeFileSync(join(directory, 'setup.exe'), 'MZ-no-archive')
    expect(() =>
      extractEmbeddedSevenZip(join(directory, 'setup.exe'), join(directory, 'out.7z'))
    ).toThrow('no 7z payload')
  })
})

describe('shouldUseUpstreamReleaseAddons', () => {
  const supportedHost = process.platform === 'win32' && process.arch === 'x64'

  it.runIf(supportedHost)('applies only when no Visual Studio can be found', () => {
    const programFiles = scratch()
    const env = { ProgramFiles: programFiles }
    expect(shouldUseUpstreamReleaseAddons(env)).toBe(true)
    expect(shouldUseUpstreamReleaseAddons({ ...env, VCINSTALLDIR: 'C:/VC' })).toBe(false)
    expect(shouldUseUpstreamReleaseAddons({ ...env, VSHU_NATIVE_SOURCE_BUILD_ONLY: '1' })).toBe(
      false
    )
    mkdirSync(join(programFiles, 'Microsoft Visual Studio', 'Installer'), { recursive: true })
    writeFileSync(join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'), '')
    expect(shouldUseUpstreamReleaseAddons(env)).toBe(false)
  })

  it.skipIf(supportedHost)('never applies off Windows x64', () => {
    expect(shouldUseUpstreamReleaseAddons({})).toBe(false)
  })
})
