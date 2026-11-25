import { requireOptionalNativeModule } from 'expo-modules-core'

export type VshuPlayStorePresenceModule = {
  /** Whether the Google Play Store app is installed and enabled. */
  isPlayStoreInstalled(): boolean
  /** Whether the Play Store installed this app, so Play delivers its updates. */
  isInstalledByPlayStore(): boolean
}

/** Null off Android and in a binary built before the module existed. */
export const VshuPlayStorePresence =
  requireOptionalNativeModule<VshuPlayStorePresenceModule>('VshuPlayStorePresence')
