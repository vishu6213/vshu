import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { VSHUD_LAUNCHER_FILENAME, VSHUD_SERVER_ENTRY_FILENAME } from './vshud-artifacts'

export const VSHUD_BUILD_HASH_LENGTH = 16

/** The launcher embeds its server digest, keeping the hash older clients calculate. */
export function hashVshudLauncher(entryPath: string): string {
  const entry = realpathSync(entryPath)
  const launcher =
    basename(entry) === VSHUD_SERVER_ENTRY_FILENAME
      ? join(dirname(entry), VSHUD_LAUNCHER_FILENAME)
      : entry
  return createHash('sha256')
    .update(readFileSync(launcher))
    .digest('hex')
    .slice(0, VSHUD_BUILD_HASH_LENGTH)
}
