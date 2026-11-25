/** R39: each ready control socket to a WSL host says which Vshu installation it belongs to. */
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { VSHUD_DECLARE_CLIENT_METHOD } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-peer-desktops-contract'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { RuntimeRpcResponse } from '../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import { wslHostClientInstanceId } from './wsl-host-client-instance'

const DECLARE_TIMEOUT_MS = 10_000

type ControlRequest = (
  method: string,
  params: unknown,
  timeoutMs: number
) => Promise<RuntimeRpcResponse<unknown>>

/** Sent on the control socket itself, so the server ties the tag to exactly that socket. */
export async function declareWslHostClient(
  environmentId: string,
  request: ControlRequest,
  isWslHost: (environmentId: string) => boolean | Promise<boolean> = isWslHostEnvironment
): Promise<void> {
  if (!(await isWslHost(environmentId))) {
    return
  }
  void request(
    VSHUD_DECLARE_CLIENT_METHOD,
    { clientInstanceId: wslHostClientInstanceId() },
    DECLARE_TIMEOUT_MS
  )
    .then((response) => {
      // An older server lacks the method; it then has no peer check, so nothing reads the tag.
      if (!response.ok && response.error.code !== 'method_not_found') {
        console.warn('[wsl-hosts] The WSL host did not note this Vshu:', response.error.message)
      }
    })
    .catch(() => {
      // A socket that dropped before the answer declares again on its next ready.
    })
}

async function isWslHostEnvironment(environmentId: string): Promise<boolean> {
  try {
    const environment = await resolveEnvironment(
      getAppEnvironment().getPath('userData'),
      environmentId
    )
    return environment.vshudDeployment?.kind === 'wsl'
  } catch {
    return false
  }
}
