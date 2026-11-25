import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  VSHUD_VERSION,
  vshudArtifactFilenames
} from '../../../../src/shared/remote-runtime/vshud-distribution/vshud-artifacts.ts'
import { readVshudMobileWebAssetFilenames } from './vshud-mobile-web-bundle.mjs'

/** The runtime enters through `.runtime-node`'s executableSha256 string, never its bytes (design D2). */
export function computeVshudFullVersion(artifactDir, { target, agentBrowserFilename }) {
  const hash = createHash('sha256')
  for (const filename of vshudArtifactFilenames(
    target,
    readVshudMobileWebAssetFilenames(artifactDir)
  )) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `vshud declares ${filename} in VSHUD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/remote-runtime/vshud-distribution/vshud-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  if (agentBrowserFilename && existsSync(join(artifactDir, agentBrowserFilename))) {
    hash.update(readFileSync(join(artifactDir, agentBrowserFilename)))
  }
  return `${VSHUD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
