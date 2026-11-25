import type { Store } from '../../loading-store/store'
import {
  listVshudMigrationSourceCutovers,
  setVshudMigrationJournalChangeListener
} from '../cutover-journals/vshud-migration-cutover-journal'

export function installVshudMigrationScrollbackRetention(
  userDataPath: string,
  store: Pick<Store, 'syncVshudMigrationScrollbackRetention'>
): void {
  const sync = (path: string): void => {
    try {
      // Retain bytes until durable commit/abort; closed tabs must still upload on retry.
      const pending = listVshudMigrationSourceCutovers(path).filter(
        (cutover) => cutover.phase === 'source-fenced' || cutover.phase === 'destination-staged'
      )
      store.syncVshudMigrationScrollbackRetention(pending.map((cutover) => cutover.manifest))
    } catch (error) {
      // An unreadable journal keeps whatever is held; releasing on a guess could lose bytes.
      console.warn('[vshud-migration] Could not sync scrollback retention:', error)
    }
  }
  setVshudMigrationJournalChangeListener(sync)
  sync(userDataPath)
}
