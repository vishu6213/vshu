import type { ManagedVshudPreloadApi } from '../../../../../preload/api/runtime/managed-vshud-api'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'

/** Web fallback stubs cannot manage SSH hosts. */
export function getManagedVshudApi(): ManagedVshudPreloadApi | undefined {
  return isWebClientLocation() ? undefined : window.api.runtimeEnvironments.managedVshud
}
