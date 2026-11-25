import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { VSHUD_SERVER_ENTRY_FILENAME } from '../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import {
  assertVshudServerRuntime,
  handoffToBundledVshud
} from './runtime-launch/vshud-bundled-runtime'
import { VSHUD_EXIT_CONFIGURATION } from './serve-startup/vshud-configuration-exit'
import { enableManagedVshudCompileCache } from './runtime-launch/vshud-compile-cache'

declare const VSHUD_SERVER_SHA256: string

let loadServer: (() => void) | undefined

try {
  if (!handoffToBundledVshud()) {
    assertVshudServerRuntime()
    const entry = realpathSync(process.argv[1] ?? __filename)
    const server = join(dirname(entry), VSHUD_SERVER_ENTRY_FILENAME)
    if (createHash('sha256').update(readFileSync(server)).digest('hex') !== VSHUD_SERVER_SHA256) {
      throw new Error('The Vshu server does not match its launcher')
    }
    loadServer = () => {
      enableManagedVshudCompileCache(dirname(entry))
      createRequire(entry)(server)
    }
  }
} catch (error) {
  console.error('vshud: failed to launch:', error)
  process.exit(VSHUD_EXIT_CONFIGURATION)
}

loadServer?.()
