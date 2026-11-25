import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import type { BackendServiceCleanup } from '../../backend/service-composition'
import { EmulatorBridge } from '../../emulator/emulator-bridge'
import { withTimeout } from '../../../shared/concurrency/promise-timeout-fallback'

// A stalled adb must not hold the final profile flush past vshud's shutdown deadline.
const EMULATOR_TEARDOWN_BUDGET_MS = 3_000

/** Android drives adb/emulator on any host; iOS backends report their own host-support errors. */
export function installVshudEmulatorBridge(
  runtime: VshuRuntimeService,
  registerCleanup: (cleanup: BackendServiceCleanup) => void
): void {
  const bridge = new EmulatorBridge()
  runtime.setEmulatorBridge(bridge)
  // Like desktop quit: stop the helpers and devices Vshu started.
  registerCleanup(() =>
    withTimeout(bridge.destroyAllSessions(), EMULATOR_TEARDOWN_BUDGET_MS, undefined)
  )
}
