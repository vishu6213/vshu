import { parseWslUncPath } from '../../shared/file-access/wsl-paths'

/** The distro a WSL shell ran this Windows CLI from; the bridge keeps it even when /mnt/c makes cwd a drive path. */
export function getWslCallerDistro(cwd = process.env.VSHU_CLI_CWD ?? ''): string | null {
  if (process.platform !== 'win32') {
    return null
  }
  return process.env.VSHU_CLI_WSL_DISTRO?.trim() || parseWslUncPath(cwd)?.distro || null
}
