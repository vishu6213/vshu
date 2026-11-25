import { collapseHomePath } from '../../shared/skills/bundled/bundled-skill-locations'
import type { VshuUninstallPath } from '../../shared/uninstall/vshu-uninstall-types'

const CODEX_ACCOUNT_HOME = /^codex-accounts[\\/][^\\/]+[\\/]home[\\/](.+)$/u

/** Paths inside Vshu's data folder (a managed Codex account home) read as a label, not a long path. */
export function describeVshuUninstallPath(
  path: string,
  roots: { homeDir: string; userDataPath: string }
): VshuUninstallPath {
  const display = collapseHomePath(path, roots.homeDir)
  // Collapsing against userData instead of home yields `~/<relative>` only for paths inside it.
  const inData = collapseHomePath(path, roots.userDataPath)
  if (inData === path) {
    return { path: display, vshuData: null }
  }
  const relative = inData.slice(2)
  const codex = CODEX_ACCOUNT_HOME.exec(relative)
  return {
    path: display,
    vshuData: codex ? { kind: 'codex-account', relative: codex[1] } : { kind: 'app-data', relative }
  }
}
