import { getVshuPushGatewayUrl } from '../../vshu-profiles/cloud-auth/profile-cloud-auth-config'
import { DesktopPushService } from '../../runtime/push/desktop-push-service'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import type { VshuRuntimeRpcServer } from '../../runtime/rpc/server/runtime-rpc'
import { mainProcessState as state } from '../main-process-state'

// Push authenticates by host keypair, so accountless hosts must register phones too; shared startup state supplies the runtime in both modes.
export function startDesktopPushService(runtimeRpc: VshuRuntimeRpcServer): void {
  const runtime: VshuRuntimeService | null = state.runtime
  if (!runtime) {
    console.warn('[push] Background push startup skipped: runtime not started')
    return
  }
  try {
    const pushService = DesktopPushService.create({
      runtime,
      runtimeRpc,
      gatewayUrl: getVshuPushGatewayUrl()
    })
    pushService?.start()
    state.desktopPushService = pushService
  } catch (error) {
    console.warn(
      '[push] Background push startup unavailable:',
      error instanceof Error ? error.message : String(error)
    )
  }
}
