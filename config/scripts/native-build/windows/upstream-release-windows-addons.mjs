#!/usr/bin/env node
// Windows hosts without MSVC cannot node-gyp the patched Windows addons. At the pinned upstream
// release their sources (native/windows-*, the node-pty and windows-process-tree patches) differ
// from ours only by brand renames in identifiers and comments, and N-API binaries load in any
// Electron/Node of that ABI. So we take the SignPath-signed binaries that release ships inside
// its installer, pinned by SHA-512, and publish them where a source build would.
// Usage: node upstream-release-windows-addons.mjs [--executable=<electron.exe>]
import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { hasWindowsCompilerSelection } from './initialize-windows-native-toolchain.mjs'
import { checkNativeBuildDirLoads } from '../node-addons/shared-native-build.mjs'
import {
  publishSharedTree,
  sharedTreeStagingPath
} from '../../artifact-storage/atomic-publication/shared-tree-publish.mjs'

const require = createRequire(import.meta.url)
const {
  isSharedNativePackage,
  nativeBuildEntryDir,
  resolveNativePackageDir
} = require('../node-addons/native-build-entry.cjs')
const { PE_MACHINE, readPeMachine } = require('./windows-pe-machine.cjs')

const PROJECT_DIR = resolve(import.meta.dirname, '../../../..')
// Fragments, as in src/shared/branding/legacy-brand-names.ts: the rebrand codemod rewrites the
// literal word, and importing that .ts here would print a module-type warning on every launch.
const UPSTREAM = ['or', 'ca'].join('')
// Upstream's own release; the digest is the one its latest.yml publishes for this installer.
export const UPSTREAM_RELEASE = {
  repository: ['stablyai', UPSTREAM].join('/'),
  tag: 'v1.4.274',
  asset: `${UPSTREAM}-windows-setup.exe`,
  size: 243494424,
  sha512: '2qkdsmgjdGNlDlKz+BrY1zCgvmY8vqyx6er8ipCT2FD6W7sCpXU4RMVSSeLgMByzOIq1Bi6D5EfIWoPv8E4WZg=='
}
const PAYLOAD = 'resources/node_modules'
const WORKSPACE_ADDONS = ['security', 'registry', 'notifications']
const SHARED_ADDONS = {
  'node-pty': ['conpty.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'],
  '@vscode/windows-process-tree': ['windows_process_tree.node']
}
const SEVEN_ZIP_SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])

/** Only an x64 Windows host with no selectable MSVC, unless source builds are demanded. */
export function shouldUseUpstreamReleaseAddons(env = process.env) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return false
  }
  if (env.VSHU_NATIVE_SOURCE_BUILD_ONLY === '1' || hasWindowsCompilerSelection(env)) {
    return false
  }
  return ![env['ProgramFiles(x86)'], env.ProgramFiles]
    .filter(Boolean)
    .some((dir) => existsSync(join(dir, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')))
}

function workspaceAddonMember(name) {
  return `${PAYLOAD}/@${UPSTREAM}/windows-${name}/build/Release/${UPSTREAM}_windows_${name}.node`
}

function sharedAddonMember(moduleName, file) {
  return `${PAYLOAD}/${moduleName}/build/Release/${file}`
}

function payloadMembers() {
  return [
    ...WORKSPACE_ADDONS.map(workspaceAddonMember),
    ...Object.entries(SHARED_ADDONS).flatMap(([moduleName, files]) =>
      files.map((file) => sharedAddonMember(moduleName, file))
    )
  ]
}

async function downloadVerifiedInstaller(targetPath) {
  const { repository, tag, asset, size, sha512 } = UPSTREAM_RELEASE
  const url = `https://github.com/${repository}/releases/download/${tag}/${asset}`
  console.log(`[native-runtime] Downloading ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status}`)
  }
  const hash = createHash('sha512')
  let received = 0
  const body = Readable.fromWeb(response.body)
  body.on('data', (chunk) => {
    hash.update(chunk)
    received += chunk.length
  })
  await pipeline(body, createWriteStream(targetPath))
  const digest = hash.digest('base64')
  if (received !== size || digest !== sha512) {
    throw new Error(`${asset} does not match the pinned release digest; refusing it`)
  }
}

/** electron-builder stores the app payload as one uncompressed 7z inside the NSIS stub. */
export function extractEmbeddedSevenZip(installerPath, archivePath) {
  const installer = readFileSync(installerPath)
  for (let at = installer.indexOf(SEVEN_ZIP_SIGNATURE); at !== -1;) {
    const startHeader = installer.subarray(at + 12, at + 32)
    if (startHeader.length === 20 && crc32(startHeader) === installer.readUInt32LE(at + 8)) {
      const length = 32n + startHeader.readBigUInt64LE(0) + startHeader.readBigUInt64LE(8)
      if (BigInt(at) + length <= BigInt(installer.length)) {
        writeFileSync(archivePath, installer.subarray(at, at + Number(length)))
        return
      }
    }
    at = installer.indexOf(SEVEN_ZIP_SIGNATURE, at + 1)
  }
  throw new Error('the installer carries no 7z payload')
}

function extractMembers(archivePath, outDir) {
  // Windows' own bsdtar reads 7z; a PATH lookup could pick up MSYS tar, which cannot.
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const result = spawnSync(tar, ['-xf', archivePath, '-C', outDir, ...payloadMembers()], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.error || result.status !== 0) {
    throw new Error(`tar could not extract the payload: ${result.error ?? result.stderr}`)
  }
}

/** Extracted payload, cached per release so later checks never download again. */
async function ensurePayload(cacheRoot) {
  const payloadDir = join(cacheRoot, `${UPSTREAM_RELEASE.tag}-x64`)
  const marker = join(payloadDir, '.complete')
  if (existsSync(marker) && readFileSync(marker, 'utf8') === UPSTREAM_RELEASE.sha512) {
    return payloadDir
  }
  const workDir = mkdtempSync(join(tmpdir(), 'vshu-upstream-addons-'))
  try {
    const installerPath = join(workDir, 'installer.exe')
    const archivePath = join(workDir, 'payload.7z')
    const extractDir = join(workDir, 'payload')
    await downloadVerifiedInstaller(installerPath)
    extractEmbeddedSevenZip(installerPath, archivePath)
    rmSync(installerPath, { force: true })
    mkdirSync(extractDir)
    extractMembers(archivePath, extractDir)
    for (const member of payloadMembers().filter((path) => path.endsWith('.node'))) {
      if (readPeMachine(join(extractDir, member)) !== PE_MACHINE.x64) {
        throw new Error(`${member} is not an x64 binary`)
      }
    }
    writeFileSync(join(extractDir, '.complete'), UPSTREAM_RELEASE.sha512)
    rmSync(payloadDir, { recursive: true, force: true })
    mkdirSync(dirname(payloadDir), { recursive: true })
    renameSync(extractDir, payloadDir)
    return payloadDir
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function copyFiles(fromDir, toDir, files) {
  for (const file of files) {
    mkdirSync(dirname(join(toDir, file)), { recursive: true })
    copyFileSync(join(fromDir, file), join(toDir, file))
  }
}

function installWorkspaceAddons(payloadDir, projectDir) {
  for (const name of WORKSPACE_ADDONS) {
    const target = join(
      projectDir,
      'native',
      `windows-${name}`,
      'build',
      'Release',
      `vshu_windows_${name}.node`
    )
    if (existsSync(target)) {
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(payloadDir, workspaceAddonMember(name)), target)
    console.log(`[native-runtime] Installed upstream ${UPSTREAM_RELEASE.tag} build at ${target}`)
  }
}

/** Publish like a source build: a shared store slot gets an immutable per-ABI entry. */
function installSharedAddons(payloadDir, projectDir, executable) {
  for (const [moduleName, files] of Object.entries(SHARED_ADDONS)) {
    const releaseDir = join(payloadDir, PAYLOAD, moduleName, 'build', 'Release')
    const packageDir = resolveNativePackageDir(moduleName, projectDir)
    const check = (dir) => checkNativeBuildDirLoads(moduleName, dir, { executable })
    if (!isSharedNativePackage(moduleName, projectDir)) {
      copyFiles(releaseDir, join(packageDir, 'build', 'Release'), files)
      continue
    }
    const entryDir = nativeBuildEntryDir(realpathSync(packageDir), moduleName)
    if (existsSync(entryDir) && check(entryDir) === null) {
      continue
    }
    const stagingDir = sharedTreeStagingPath(entryDir)
    copyFiles(releaseDir, stagingDir, files)
    const reason = check(stagingDir)
    if (reason !== null) {
      rmSync(stagingDir, { recursive: true, force: true })
      throw new Error(`the upstream ${moduleName} build is unusable here: ${reason}`)
    }
    publishSharedTree(stagingDir, entryDir, { isUsable: (dir) => check(dir) === null })
    console.log(`[native-runtime] Published upstream ${UPSTREAM_RELEASE.tag} build at ${entryDir}`)
  }
}

export async function installUpstreamReleaseWindowsAddons({
  projectDir = PROJECT_DIR,
  executable = process.execPath
} = {}) {
  const cacheRoot = join(projectDir, 'node_modules', '.cache', 'vshu-upstream-windows-addons')
  const payloadDir = await ensurePayload(cacheRoot)
  installWorkspaceAddons(payloadDir, projectDir)
  installSharedAddons(payloadDir, projectDir, executable)
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const inline = process.argv.find((arg) => arg.startsWith('--executable='))
  try {
    await installUpstreamReleaseWindowsAddons({
      executable: inline ? inline.slice('--executable='.length) : process.execPath
    })
  } catch (error) {
    console.error(`[native-runtime] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
