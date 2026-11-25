// Imported first by vshud's entries (esbuild runs it first); the built Electron main and daemon drop
// the same keys from their banner (config/build-plugins/inherited-vshu-identity-banner.ts).
import { dropInheritedVshuIdentityEnv } from './inherited-vshu-identity-env'

dropInheritedVshuIdentityEnv()
