import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import { removeManagedVshudEnvironment } from '../../shared/remote-runtime/host-store/runtime-environment-managed-vshud-store'
import {
  listEnvironments,
  removeEnvironment
} from '../../shared/remote-runtime/host-store/runtime-environment-store'
import { getVshudSshDeployment } from '../../shared/remote-runtime/host-catalog/runtime-environments'

/** Remove destroyed VM servers so managed tunnels stop reconnecting. */
export async function releaseEphemeralVmRuntimeEnvironments(
  userDataPath: string,
  runtime: Pick<EphemeralVmRuntimeRecord, 'runtimeEnvironmentId' | 'sshTargetId'>,
  // Same retirement as a Settings removal, so the host's session partition and transport go too.
  retireRemovedEnvironment: (environmentId: string) => void
): Promise<void> {
  // Relay-era conversions may have recorded only the SSH target, not the server ID.
  const environments = (await listEnvironments(userDataPath)).filter(
    (entry) =>
      entry.id === runtime.runtimeEnvironmentId ||
      (runtime.sshTargetId !== undefined &&
        getVshudSshDeployment(entry)?.sshTargetId === runtime.sshTargetId)
  )
  for (const environment of environments) {
    if (!environment.vshudDeployment) {
      await removeEnvironment(userDataPath, environment.id)
      retireRemovedEnvironment(environment.id)
      continue
    }
    const { closeVshudManagedTunnel } =
      await import('../managed-server/lifecycle/vshud-managed-tunnel')
    await closeVshudManagedTunnel(environment.id).catch(() => undefined)
    await removeManagedVshudEnvironment(userDataPath, environment.id)
    retireRemovedEnvironment(environment.id)
  }
}
