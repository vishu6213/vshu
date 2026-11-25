import { materializeOmpFreshConfig } from '../../../shared/agent-launch/startup/omp-fresh-config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { createHash } from 'node:crypto'
import {
  VSHU_PI_AGENT_STATUS_EXTENSION_FILE,
  getPiAgentStatusExtensionSource
} from './agent-status/agent-status-extension-source'
import {
  VSHU_PI_PREFILL_EXTENSION_FILE,
  getPiPrefillExtensionSource
} from './prefill-extension-source'
import { VSHU_PI_EXTENSION_FILE, getPiTitlebarExtensionSource } from './titlebar-extension-source'
import { safeRemoveOverlay } from '../../pty/scrollback/overlay-mirror'
import { migrateLegacyOmpOverlayState } from './legacy-omp-overlay-migration'
import { removeLegacyBrandManagedFiles } from '../../agent-hooks/installation/legacy-brand-managed-files'
import type { PiAgentKind } from '../../../shared/agent-launch/catalog/pi-agent-kind'

const PI_AGENT_SUBDIR = 'agent'
const VSHU_MANAGED_EXTENSION_MARKER = '@vshu-managed-pi-extension'
const OMP_MANAGED_STATUS_EXTENSION_DIR = 'omp-managed-status-extension'

type ManagedExtensionWriteResult = 'written' | 'skipped-user-owned' | 'failed'

type PiManagedExtensionEnv = {
  extensionDir?: string
  sourceAgentDir: string
  statusExtensionPath?: string
}

type LegacyOverlayAgentKind = Exclude<PiAgentKind, 'prime-agent'>

// Retain old per-kind roots for upgrade cleanup.
const OVERLAY_ROOT_DIR_NAME: Record<LegacyOverlayAgentKind, string> = {
  pi: 'pi-agent-overlays',
  omp: 'omp-agent-overlays'
}

// Resolve by launched kind; disk-presence fallback would shadow the other agent's extensions.
const AGENT_HOME_DIR_NAME: Record<PiAgentKind, string> = {
  pi: '.pi',
  omp: '.omp',
  'prime-agent': '.prime'
}

function getDefaultPiAgentDir(kind: PiAgentKind, configDirName: string | undefined): string {
  const root = kind === 'omp' ? configDirName || AGENT_HOME_DIR_NAME.omp : AGENT_HOME_DIR_NAME[kind]
  return join(homedir(), root, PI_AGENT_SUBDIR)
}

function toSafeOverlayDirName(ptyId: string): string {
  return createHash('sha256').update(ptyId).digest('hex').slice(0, 32)
}

function withVshuManagedExtensionMarker(source: string): string {
  return source.includes(VSHU_MANAGED_EXTENSION_MARKER)
    ? source
    : `// ${VSHU_MANAGED_EXTENSION_MARKER}\n${source}`
}

export class PiTitlebarExtensionService {
  private getOverlayRoot(kind: LegacyOverlayAgentKind): string {
    return join(getAppEnvironment().getPath('userData'), OVERLAY_ROOT_DIR_NAME[kind])
  }

  private getSourceOverlayDir(sourceAgentDir: string, kind: LegacyOverlayAgentKind): string {
    // Rescue state from overlays used before managed extensions.
    return join(this.getOverlayRoot(kind), toSafeOverlayDirName(`source:${sourceAgentDir}`))
  }

  private getPtyOverlayDir(ptyId: string, kind: LegacyOverlayAgentKind): string {
    // Resolve old PTY-scoped paths for migration cleanup.
    return join(this.getOverlayRoot(kind), toSafeOverlayDirName(ptyId))
  }

  private getLegacyOverlayDir(ptyId: string, kind: LegacyOverlayAgentKind): string {
    return join(this.getOverlayRoot(kind), ptyId)
  }

  private safeRemoveOverlay(overlayDir: string, kind: LegacyOverlayAgentKind): void {
    safeRemoveOverlay(overlayDir, this.getOverlayRoot(kind))
  }

  private writeManagedExtension(path: string, source: string): ManagedExtensionWriteResult {
    let installed: string | undefined
    try {
      installed = readFileSync(path, 'utf8')
    } catch {
      installed = undefined
    }
    if (installed === source) {
      return 'written'
    }
    if (installed !== undefined && !installed.includes(VSHU_MANAGED_EXTENSION_MARKER)) {
      return 'skipped-user-owned'
    }

    try {
      writeFileSync(path, source)
      return 'written'
    } catch {
      return 'failed'
    }
  }

  private writeOmpFallbackStatusExtension(source: string): string | undefined {
    const fallbackDir = join(
      getAppEnvironment().getPath('userData'),
      OMP_MANAGED_STATUS_EXTENSION_DIR
    )
    try {
      mkdirSync(fallbackDir, { recursive: true })
    } catch {
      return undefined
    }

    const fallbackPath = join(fallbackDir, VSHU_PI_AGENT_STATUS_EXTENSION_FILE)
    return this.writeManagedExtension(fallbackPath, source) === 'written' ? fallbackPath : undefined
  }

  /** Refreshes Vshu-owned extension files in a Pi agent dir; user-owned files with these names stay. */
  installManagedExtensions(sourceAgentDir: string, kind: PiAgentKind): PiManagedExtensionEnv {
    const extensionsDir = join(sourceAgentDir, 'extensions')
    try {
      mkdirSync(extensionsDir, { recursive: true })
    } catch {
      return { sourceAgentDir }
    }
    removeLegacyBrandManagedFiles(
      extensionsDir,
      [VSHU_PI_EXTENSION_FILE, VSHU_PI_PREFILL_EXTENSION_FILE, VSHU_PI_AGENT_STATUS_EXTENSION_FILE],
      VSHU_MANAGED_EXTENSION_MARKER
    )

    if (kind !== 'prime-agent') {
      this.writeManagedExtension(
        join(extensionsDir, VSHU_PI_EXTENSION_FILE),
        withVshuManagedExtensionMarker(getPiTitlebarExtensionSource(kind))
      )
      this.writeManagedExtension(
        join(extensionsDir, VSHU_PI_PREFILL_EXTENSION_FILE),
        withVshuManagedExtensionMarker(getPiPrefillExtensionSource(kind))
      )
    }
    const statusExtensionPath = join(extensionsDir, VSHU_PI_AGENT_STATUS_EXTENSION_FILE)
    const statusSource = withVshuManagedExtensionMarker(getPiAgentStatusExtensionSource(kind))
    const statusResult = this.writeManagedExtension(statusExtensionPath, statusSource)

    return {
      extensionDir: extensionsDir,
      sourceAgentDir,
      statusExtensionPath:
        statusResult === 'written'
          ? statusExtensionPath
          : kind === 'omp'
            ? this.writeOmpFallbackStatusExtension(statusSource)
            : undefined
    }
  }

  buildFreshOmpEnv(): Record<string, string> {
    return {
      VSHU_OMP_FRESH_CONFIG: materializeOmpFreshConfig(
        join(getAppEnvironment().getPath('userData'), OMP_MANAGED_STATUS_EXTENSION_DIR)
      )
    }
  }

  buildPtyEnv(
    ptyId: string,
    existingAgentDir: string | undefined,
    kind: PiAgentKind,
    options?: { materializeDefaultHome?: boolean; configDirName?: string; cliOnPath?: boolean }
  ): Record<string, string> {
    const freshConfigEnv = kind === 'omp' ? this.buildFreshOmpEnv() : {}
    const sourceAgentDir = existingAgentDir || getDefaultPiAgentDir(kind, options?.configDirName)
    if (kind !== 'prime-agent') {
      try {
        this.safeRemoveOverlay(this.getPtyOverlayDir(ptyId, kind), kind)
        this.safeRemoveOverlay(this.getLegacyOverlayDir(ptyId, kind), kind)
      } catch {
        // Locked legacy overlays must not prevent terminal startup.
      }
    }

    // Bare shells must not recreate deleted agent homes (#10196) or write into one whose CLI is gone (#43445).
    const materializeDefaultHome = options?.materializeDefaultHome !== false
    if (!materializeDefaultHome && (options?.cliOnPath === false || !existsSync(sourceAgentDir))) {
      if (kind === 'omp') {
        const statusSource = withVshuManagedExtensionMarker(getPiAgentStatusExtensionSource(kind))
        const statusExtensionPath = this.writeOmpFallbackStatusExtension(statusSource)
        return statusExtensionPath
          ? { ...freshConfigEnv, VSHU_OMP_STATUS_EXTENSION: statusExtensionPath }
          : freshConfigEnv
      }
      return {}
    }

    if (kind === 'omp') {
      migrateLegacyOmpOverlayState(sourceAgentDir, this.getSourceOverlayDir(sourceAgentDir, 'omp'))
    }

    const installed = this.installManagedExtensions(sourceAgentDir, kind)
    const env: Record<string, string> = { ...freshConfigEnv }
    if (kind === 'omp') {
      env.VSHU_OMP_SOURCE_AGENT_DIR = installed.sourceAgentDir
      if (installed.statusExtensionPath) {
        env.VSHU_OMP_STATUS_EXTENSION = installed.statusExtensionPath
      }
    } else if (kind === 'prime-agent') {
      env.VSHU_PRIME_AGENT_SOURCE_AGENT_DIR = installed.sourceAgentDir
    } else {
      env.VSHU_PI_SOURCE_AGENT_DIR = installed.sourceAgentDir
    }
    return env
  }

  clearPty(ptyId: string): void {
    // Teardown lacks agent kind; sweep both PTY roots but preserve source overlays containing user state.
    for (const kind of Object.keys(OVERLAY_ROOT_DIR_NAME) as LegacyOverlayAgentKind[]) {
      try {
        this.safeRemoveOverlay(this.getPtyOverlayDir(ptyId, kind), kind)
        this.safeRemoveOverlay(this.getLegacyOverlayDir(ptyId, kind), kind)
      } catch {
        // Windows AV/indexer locks leave harmless stale overlays; retry on the next spawn/teardown.
      }
    }
  }
}

export const piTitlebarExtensionService = new PiTitlebarExtensionService()
