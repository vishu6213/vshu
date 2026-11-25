import { join } from 'node:path'
import { hashVshudLauncher } from '../../../shared/remote-runtime/vshud-distribution/vshud-build-identity'
import { VSHUD_LAUNCHER_FILENAME } from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'

export function computeLocalVshudBuildHash(localVshudDir: string): string {
  return hashVshudLauncher(join(localVshudDir, VSHUD_LAUNCHER_FILENAME))
}
