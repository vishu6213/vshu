import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  VSHUD_MOBILE_WEB_MANIFEST,
  VSHUD_NODE_RUNTIME_MARKER_FILENAME,
  VSHUD_SERVER_TARGET_FILENAME,
  VSHUD_TEMPLATE_MANIFEST_FILENAME,
  VSHUD_TEMPLATE_TARGETS_DIR,
  vshudTemplateCommonFilenames,
  vshudTemplateTargetFilenames
} from '../../../../src/shared/remote-runtime/vshud-distribution/vshud-artifacts.ts'
import {
  COMPAT_SERVER_TARGETS,
  VSHUD_TEMPLATE_TARGETS,
  pinnedNodeRuntimeAsset
} from '../../../../src/shared/node-runtime/node-runtime-pin.ts'

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
  return createHash('sha256').update(contents).digest('hex')
}

function targetFileContents(target, filename) {
  if (filename === VSHUD_SERVER_TARGET_FILENAME) {
    return `${target}\n`
  }
  if (filename === VSHUD_NODE_RUNTIME_MARKER_FILENAME) {
    return `${pinnedNodeRuntimeAsset(target).executableSha256}\n`
  }
  return `${target}:${filename}`
}

export async function writeVshudTemplateTestFixture(resourcesDir, { compat = false } = {}) {
  const templateDir = join(resourcesDir, 'vshud-template')
  const commonSha256 = {}
  for (const filename of vshudTemplateCommonFilenames(['out/mobile-web/index.html'])) {
    commonSha256[filename] = await write(
      join(templateDir, ...filename.split('/')),
      Buffer.from(
        filename === VSHUD_MOBILE_WEB_MANIFEST
          ? JSON.stringify({ assets: [{ path: 'index.html' }] })
          : `common:${filename}`
      )
    )
  }
  const targets = {}
  for (const target of [...VSHUD_TEMPLATE_TARGETS, ...(compat ? COMPAT_SERVER_TARGETS : [])]) {
    const targetDir = join(templateDir, VSHUD_TEMPLATE_TARGETS_DIR, target)
    const files = {}
    for (const filename of vshudTemplateTargetFilenames(target)) {
      files[filename] = await write(
        join(targetDir, ...filename.split('/')),
        targetFileContents(target, filename)
      )
    }
    targets[target] = { files }
  }
  const browserName = 'agent-browser-linux-x64'
  targets['linux-x64-glibc'] = {
    ...targets['linux-x64-glibc'],
    browserName,
    browserSha256: await write(
      join(templateDir, VSHUD_TEMPLATE_TARGETS_DIR, 'linux-x64-glibc', browserName),
      'browser'
    )
  }
  await writeFile(
    join(templateDir, VSHUD_TEMPLATE_MANIFEST_FILENAME),
    JSON.stringify({ schemaVersion: 3, commonSha256, targets })
  )
  return templateDir
}
