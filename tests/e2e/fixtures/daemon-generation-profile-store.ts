import path from 'node:path'
import { installVshudHostAdapters } from '../../../src/main/vshud/host-runtime/vshud-host-adapters'
import type { Store } from '../../../src/main/persistence/loading-store/store'
import { createProfileStateStore } from '../../../src/main/persistence/profile-state/startup/profile-state-store-factory'

export function createDaemonGenerationProfileStore(directory: string): Store {
  installVshudHostAdapters()
  // The bundled fixture has no profile writer worker; use the synchronous SQLite authority.
  return createProfileStateStore({
    dataFile: path.join(directory, 'vshu-data.json'),
    databaseFile: path.join(directory, 'profile-state.sqlite'),
    profileId: 'legacy-close-fixture'
  }).store
}
