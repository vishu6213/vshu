import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_MANIFEST_FILENAME } from '../../../shared/plugins/manifest/plugin-manifest'
import {
  PLUGIN_MANIFEST_FILE_NAMES,
  withLegacyEngineRange
} from '../../../shared/plugins/manifest/plugin-manifest-file-names'

// Bound startup/preview metadata reads independently of artifact payload sizes.
export const PLUGIN_MANIFEST_MAX_BYTES = 1024 * 1024

/** Path of the manifest `rootDir` holds, preferring vshu-plugin.json over pre-rebrand names. */
export function findPluginManifestFile(rootDir: string): string | null {
  const fileName = PLUGIN_MANIFEST_FILE_NAMES.find((name) => existsSync(join(rootDir, name)))
  return fileName === undefined ? null : join(rootDir, fileName)
}

async function readBoundedText(filePath: string): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength
    if (totalBytes > PLUGIN_MANIFEST_MAX_BYTES) {
      throw new Error(`${PLUGIN_MANIFEST_FILENAME} exceeds ${PLUGIN_MANIFEST_MAX_BYTES} bytes`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8')
}

// A legacy range is rewritten here so every install, discovery and update path sees engines.vshu.
function normalizeLegacyManifestText(text: string): string {
  try {
    const normalized = withLegacyEngineRange(JSON.parse(text))
    return normalized === null ? text : JSON.stringify(normalized)
  } catch {
    // Callers report the invalid JSON with their own context.
    return text
  }
}

export async function readPluginManifestText(rootDir: string): Promise<string> {
  // Without any manifest, read the current name so callers get its ENOENT.
  const filePath = findPluginManifestFile(rootDir) ?? join(rootDir, PLUGIN_MANIFEST_FILENAME)
  return normalizeLegacyManifestText(await readBoundedText(filePath))
}
