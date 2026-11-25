import { advertisedVshudMigrationBlobCapabilities } from '../../../shared/vshud-migration/vshud-migration-blob-transfer'
import { SESSION_TERMINAL_SCROLLBACK_READ_RUNTIME_CAPABILITY } from '../../../shared/remote-runtime/protocol/session-tabs-runtime-capabilities'
import { servesWslMovedPaneHistory } from './vshud-migration-wsl-destination'

/**
 * Migration blob kinds this host installs, plus the stored-scrollback read a WSL move's destination
 * serves. Terminal history and the scrollback read stay off everywhere but a WSL host.
 */
export function advertisedVshudMigrationDestinationCapabilities(): string[] {
  const wslHost = servesWslMovedPaneHistory()
  return [
    ...advertisedVshudMigrationBlobCapabilities({ wslHost }),
    ...(wslHost ? [SESSION_TERMINAL_SCROLLBACK_READ_RUNTIME_CAPABILITY] : [])
  ]
}
