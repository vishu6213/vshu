import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { waitForPromiseWithSignal } from '../../../shared/concurrency/abort-signal-reason'
import {
  VSHUD_MOBILE_WEB_DIR,
  VSHUD_MOBILE_WEB_MANIFEST,
  VSHUD_NODE_RUNTIME_MARKER_FILENAME,
  VSHUD_SERVER_TARGET_FILENAME,
  VSHUD_TEMPLATE_MANIFEST_FILENAME,
  VSHUD_TEMPLATE_TARGETS_DIR,
  VSHUD_VERSION_FILENAME,
  compareCodeUnits,
  isVshudExecutableArtifact,
  isVshudMobileWebAssetPath,
  vshudArtifactFilenames,
  vshudTemplateCommonFilenames,
  vshudTemplatePackagedRipgrep,
  vshudTemplateTargetFilenames
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import {
  pinnedNodeRuntimeAsset,
  type NodeRuntimeTarget
} from '../../../shared/node-runtime/node-runtime-pin'
import { findVshudCachePath } from '../../node-runtime/vshud-cache-path'
import type { PinnedRuntimeMaterializeOptions } from '../../node-runtime/pinned-runtime-materializer'
import { readVshudArtifactVerificationRecord } from './vshud-artifact-verification-record'
import { vshudArtifactSlotName } from './vshud-artifact-slot-name'
import {
  isCompleteArtifact,
  rememberVerification,
  sameHashes,
  signSlot,
  slotMatchesRecord,
  verifiedArtifactIdentity,
  type ArtifactSource,
  type ExpectedSha256
} from './vshud-artifact-source-verification'
import { VshudTemplateManifestSchema, type VshudTemplateManifest } from './vshud-template-manifest'
import {
  VshudArtifactsUnavailableError,
  VshudHostUnsupportedError
} from '../diagnostics/vshud-host-unavailable'

type MaterializeOptions = PinnedRuntimeMaterializeOptions & {
  templateDir?: string
  cacheRoot?: string
  /** WSL wake only: trust recorded stat signatures instead of rehashing bytes. */
  trustVerificationRecord?: boolean
}

const materializations = new Map<string, Promise<string>>()
// Retain handed-out slots: concurrent deployments may still be reading them.
const materializedVersions = new Set<string>()

export function materializedVshudArtifactVersions(): ReadonlySet<string> {
  return materializedVersions
}

/** Reference the runtime separately from the verified slot. */
export async function materializeVshudArtifact(
  target: NodeRuntimeTarget,
  options: MaterializeOptions = {}
): Promise<string> {
  options.signal?.throwIfAborted()
  const templateDir = options.templateDir ?? resolveVshudTemplateDir()
  const cacheRoot =
    options.cacheRoot ?? join(getAppEnvironment().getPath('userData'), 'vshud-artifacts')
  const trustVerificationRecord = options.trustVerificationRecord === true
  // SSH/local callers must not join fills that trust verification records.
  const key = `${templateDir}\0${cacheRoot}\0${target}\0${trustVerificationRecord}`
  const existing = materializations.get(key)
  if (existing) {
    return waitForPromiseWithSignal(existing, options.signal)
  }
  // Cancellation detaches one caller; the bounded cache fill still serves other deployments.
  const pending = assembleVshudArtifact({
    templateDir,
    cacheRoot,
    target,
    trustVerificationRecord
  }).finally(() => materializations.delete(key))
  materializations.set(key, pending)
  return waitForPromiseWithSignal(pending, options.signal)
}

export async function assembleVshudArtifact(args: {
  templateDir: string
  cacheRoot: string
  target: NodeRuntimeTarget
  manifest?: VshudTemplateManifest
  now?: () => number
  /** Disabled for SSH/local serve: hash every launch without reading/writing records. */
  trustVerificationRecord?: boolean
}): Promise<string> {
  const trust = args.trustVerificationRecord === true
  const manifest = args.manifest ?? (await readTemplateManifest(args.templateDir))
  const mobileWebAssets = templateMobileWebAssets(manifest)
  const sources = artifactSources(args.templateDir, args.target, manifest, mobileWebAssets)
  const expected = expectedTemplateSha256(args.target, manifest, mobileWebAssets)
  const targetRoot = join(args.cacheRoot, args.target)
  const nowMs = (args.now ?? Date.now)()
  const record = trust ? await readVshudArtifactVerificationRecord(targetRoot) : null
  const identity = await verifiedArtifactIdentity(sources, expected, record, nowMs, trust)
  await verifyTemplateMarkers(args.templateDir, args.target)
  const { fullVersion, sourceHashes } = identity
  const recordedSlot =
    record && record.contentDigest === identity.contentDigest && sameHashes(record, sourceHashes)
      ? record.slot
      : null
  let slotFromRecord = false
  const cached = await findVshudCachePath(
    (attempt) => join(targetRoot, vshudArtifactSlotName(fullVersion, attempt)),
    async (path) => {
      slotFromRecord = await slotMatchesRecord(path, fullVersion, sources, recordedSlot, nowMs)
      return slotFromRecord || isCompleteArtifact(path, fullVersion, sources, sourceHashes)
    }
  )
  const targetDir = cached.path
  materializedVersions.add(fullVersion)
  if (cached.verified) {
    const now = new Date()
    await utimes(targetDir, now, now).catch(() => undefined)
    if (trust) {
      const slot = slotFromRecord ? recordedSlot : await signSlot(targetDir, sources, nowMs)
      await rememberVerification(targetRoot, record, identity, slot)
    }
    return targetDir
  }
  await mkdir(targetRoot, { recursive: true })
  const stagingDir = join(targetRoot, `.staging-${process.pid}-${randomUUID()}`)
  try {
    for (const source of sources) {
      const destination = join(stagingDir, source.filename)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source.path, destination)
      if (source.executable && !args.target.startsWith('win32-')) {
        await chmod(destination, 0o755)
      }
    }
    await writeFile(join(stagingDir, VSHUD_VERSION_FILENAME), `${fullVersion}\n`, { mode: 0o600 })
    if (!(await isCompleteArtifact(stagingDir, fullVersion, sources, sourceHashes))) {
      throw new Error('Vshud artifact sources changed while copying')
    }
    try {
      await rename(stagingDir, targetDir)
    } catch (error) {
      if (!(await isCompleteArtifact(targetDir, fullVersion, sources, sourceHashes))) {
        throw new Error(`Vshud artifact cache entry is unavailable or corrupted: ${targetDir}`, {
          cause: error
        })
      }
    }
    if (trust) {
      // Fresh copies are unsettled, so the next launch must hash again.
      await rememberVerification(targetRoot, record, identity, null)
    }
    return targetDir
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

function artifactSources(
  templateDir: string,
  target: NodeRuntimeTarget,
  manifest: VshudTemplateManifest,
  mobileWebAssets: readonly string[]
): ArtifactSource[] {
  const targetDir = join(templateDir, VSHUD_TEMPLATE_TARGETS_DIR, target)
  const targetManifest = manifest.targets[target]
  if (!targetManifest) {
    throw new VshudHostUnsupportedError(`Packaged vshud template does not support ${target}`)
  }
  const packagedRipgrep = vshudTemplatePackagedRipgrep(
    manifest.schemaVersion,
    target,
    targetManifest.packagedRipgrep
  )
  const targetFiles = new Set(vshudTemplateTargetFilenames(target))
  const required = vshudArtifactFilenames(target, mobileWebAssets).map((filename) => ({
    filename,
    path: join(
      filename === packagedRipgrep
        ? dirname(templateDir)
        : targetFiles.has(filename)
          ? targetDir
          : templateDir,
      ...filename.split('/')
    ),
    executable: isVshudExecutableArtifact(filename)
  }))
  if (!targetManifest.browserName) {
    return required
  }
  return [
    ...required,
    {
      filename: targetManifest.browserName,
      path: join(
        targetManifest.packagedBrowser ? dirname(templateDir) : targetDir,
        targetManifest.browserName
      ),
      executable: true
    }
  ]
}

function expectedTemplateSha256(
  target: NodeRuntimeTarget,
  manifest: VshudTemplateManifest,
  mobileWebAssets: readonly string[]
): Map<string, ExpectedSha256> {
  const targetManifest = manifest.targets[target]
  if (!targetManifest) {
    throw new VshudHostUnsupportedError(`Packaged vshud template does not support ${target}`)
  }
  const expected = new Map<string, ExpectedSha256>()
  for (const filename of vshudTemplateCommonFilenames(mobileWebAssets)) {
    const sha256 = manifest.commonSha256[filename]
    if (!sha256) {
      throw new Error(`Packaged vshud template manifest omits ${filename}`)
    }
    expected.set(filename, { sha256, label: `vshud template ${filename}` })
  }
  for (const filename of vshudTemplateTargetFilenames(target)) {
    const sha256 = targetManifest.files[filename]
    if (!sha256) {
      throw new Error(`Packaged vshud template manifest omits ${target} ${filename}`)
    }
    expected.set(filename, { sha256, label: `${target} ${filename}` })
  }
  if (targetManifest.browserName && targetManifest.browserSha256) {
    // Browser names must not override required-file digests.
    if (expected.has(targetManifest.browserName)) {
      throw new Error(`Packaged vshud template ${target} browser name collides with a slot file`)
    }
    expected.set(targetManifest.browserName, {
      sha256: targetManifest.browserSha256,
      label: `${target} browser`
    })
  }
  return expected
}

/** Read asset names from the verified template manifest without extra WSL-wake file reads. */
function templateMobileWebAssets(manifest: VshudTemplateManifest): string[] {
  const prefix = `${VSHUD_MOBILE_WEB_DIR}/`
  const assets = Object.keys(manifest.commonSha256).filter(
    (filename) => filename.startsWith(prefix) && filename !== VSHUD_MOBILE_WEB_MANIFEST
  )
  // Asset names become slot copy destinations; reject paths that escape.
  const unsafe = assets.find(
    (filename) => !isVshudMobileWebAssetPath(filename.slice(prefix.length))
  )
  if (unsafe) {
    throw new Error(`Packaged vshud template names an unsafe page asset: ${unsafe}`)
  }
  return assets.sort(compareCodeUnits)
}

async function readTemplateManifest(templateDir: string): Promise<VshudTemplateManifest> {
  return VshudTemplateManifestSchema.parse(
    JSON.parse(await readFile(join(templateDir, VSHUD_TEMPLATE_MANIFEST_FILENAME), 'utf8'))
  )
}

async function verifyTemplateMarkers(
  templateDir: string,
  target: NodeRuntimeTarget
): Promise<void> {
  const targetDir = join(templateDir, VSHUD_TEMPLATE_TARGETS_DIR, target)
  if ((await readFile(join(targetDir, VSHUD_SERVER_TARGET_FILENAME), 'utf8')).trim() !== target) {
    throw new Error(`Packaged vshud template target identity does not match ${target}`)
  }
  // Match this client’s runtime pin: it is the runtime the client will upload.
  const runtimeReference = await readFile(
    join(targetDir, VSHUD_NODE_RUNTIME_MARKER_FILENAME),
    'utf8'
  )
  if (runtimeReference.trim() !== pinnedNodeRuntimeAsset(target).executableSha256) {
    throw new Error(`Packaged vshud template ${target} does not reference the pinned Node`)
  }
}

export function getVshudTemplateCandidates(): string[] {
  const candidates: string[] = []
  if (process.env.VSHU_VSHUD_TEMPLATE_PATH) {
    candidates.push(process.env.VSHU_VSHUD_TEMPLATE_PATH)
  }
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'vshud-template'))
  }
  const appPath = getAppEnvironment().getAppPath()
  candidates.push(
    join(appPath, 'out', 'vshud-template'),
    join(appPath, 'resources', 'vshud-template')
  )
  return [...new Set(candidates)]
}

export function hasVshudTemplate(): boolean {
  return getVshudTemplateCandidates().some((candidate) => existsSync(candidate))
}

function resolveVshudTemplateDir(): string {
  const found = getVshudTemplateCandidates().find((candidate) => existsSync(candidate))
  if (!found) {
    throw new VshudArtifactsUnavailableError('The packaged vshud deployment template is missing')
  }
  return found
}

export function resetVshudArtifactMaterializationsForTests(): void {
  materializations.clear()
}
