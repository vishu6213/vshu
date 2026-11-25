import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-lifecycle/app-environment'

/** Keep this reachable from plain-Node entries; the build guard rejects Electron imports here. */
export type WorkerEntryLayout = {
  isPackaged: boolean
  /** Undefined on a non-Electron host: `process.resourcesPath` is Electron-only. */
  resourcesPath: string | undefined
  moduleDir: string
}

export function resolveWorkerThreadEntryPath(
  layout: WorkerEntryLayout,
  entryFileName: string
): string {
  // Plain-Node vshud can be packaged without Electron resources; its workers live beside the module.
  if (layout.isPackaged && layout.resourcesPath) {
    const unpacked = join(layout.resourcesPath, 'app.asar.unpacked', 'out', 'main', entryFileName)
    if (existsSync(unpacked)) {
      return unpacked
    }
    const unpackedApp = join(layout.resourcesPath, 'app', 'out', 'main', entryFileName)
    if (existsSync(unpackedApp)) {
      return unpackedApp
    }
    const inModuleDir = join(layout.moduleDir, entryFileName)
    if (existsSync(inModuleDir)) {
      return inModuleDir
    }
    return join(layout.resourcesPath, 'app.asar', 'out', 'main', entryFileName)
  }
  return join(layout.moduleDir, entryFileName)
}

// The build's `chunkFileNames` folder; worker entries sit one level up, beside the main entry.
const SHARED_CHUNK_DIR_NAME = 'chunks'

export function currentWorkerEntryLayout(moduleDir: string): WorkerEntryLayout {
  return {
    isPackaged: hasAppEnvironment() && getAppEnvironment().isPackaged(),
    resourcesPath:
      'resourcesPath' in process && typeof process.resourcesPath === 'string'
        ? process.resourcesPath
        : undefined,
    // Why: a caller bundled into a shared chunk sees `out/main/chunks` as its `__dirname`.
    moduleDir: basename(moduleDir) === SHARED_CHUNK_DIR_NAME ? dirname(moduleDir) : moduleDir
  }
}
