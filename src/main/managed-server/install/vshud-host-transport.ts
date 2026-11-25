import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { WslVshudHostTarget } from '../../wsl/vshud/wsl-vshud-host-target'
import type { RemoteInstallTransport } from './remote-install-transport'
import type { VshudLaunchDetach } from './vshud-remote-launch'

/** Only id/label have the same meaning across host kinds. */
export type VshudHostTarget = SshTarget | WslVshudHostTarget

export function isWslVshudHostTarget(target: VshudHostTarget): target is WslVshudHostTarget {
  return 'kind' in target && target.kind === 'wsl'
}

export type VshudHostTransport = RemoteInstallTransport & {
  getTarget(): VshudHostTarget
  /** Absent on SSH, which detaches with nohup. */
  readonly vshudLaunchDetach?: VshudLaunchDetach
  /** Pass client-only host facts at launch; SSH adds none. */
  readonly vshudLaunchEnv?: (
    launch: VshudLaunchEnvRequest
  ) => Promise<readonly VshudLaunchEnvEntry[]>
  /** WSL only: a transport whose every host command first runs the POSIX `fence` statement. */
  readonly withCommandFence?: (fence: string) => VshudHostTransport
}

/** The slot being launched; entries only its own build understands must check the version. */
export type VshudLaunchEnvRequest = { readonly fullVersion: string }

/** `keep-existing` applies the value only when the launching shell has none, so a user's own setting wins. */
export type VshudLaunchEnvEntry = readonly [name: string, value: string, mode?: 'keep-existing']
