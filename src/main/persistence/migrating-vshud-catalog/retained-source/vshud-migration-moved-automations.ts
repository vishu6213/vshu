/** Moves carry automations disabled, which every server version accepts; re-enable those that ran here once the move commits. */
import { z } from 'zod'
import type { Automation } from '../../../../shared/automations/automation-definition'
import { isRetainedVshudMigrationSourceCutover } from '../../../../shared/vshud-migration/vshud-migration-source-cutover'
import { parsePairingCode } from '../../../../shared/remote-runtime/pairing/pairing'
import {
  VSHUD_MIGRATION_DESTINATION_UNSUPPORTED,
  sendSupportedMigrationRequest,
  type CatalogRequestOptions
} from '../../../managed-server/migration/catalog/vshud-migration-request'
import {
  listVshudMigrationCutoverChainForTarget,
  listVshudMigrationSourceCutovers,
  writeVshudMigrationSourceCutover
} from '../cutover-journals/vshud-migration-cutover-journal'

/** Resolves false when the server answers that it can't; throws when it can't be reached. */
export type EnableServerAutomation = (automation: Automation) => Promise<boolean>

const enablesInFlight = new Map<string, Promise<number>>()

/** Returns how many moved automations the server refused to re-enable; unreachable ones retry next connect. */
export function enableMovedVshudAutomations(
  userDataPath: string,
  migrationId: string,
  enable: EnableServerAutomation
): Promise<number> {
  const pending = enablesInFlight.get(migrationId)
  if (pending) {
    return pending
  }
  const run = enableOnce(userDataPath, migrationId, enable).finally(() =>
    enablesInFlight.delete(migrationId)
  )
  enablesInFlight.set(migrationId, run)
  return run
}

/** A delta move must not strand enables an earlier move of the same host still owes. */
export async function enableMovedVshudAutomationsForTarget(
  userDataPath: string,
  sshTargetId: string,
  enable: EnableServerAutomation
): Promise<number> {
  let leftDisabled = 0
  for (const cutover of listVshudMigrationCutoverChainForTarget(userDataPath, sshTargetId)) {
    leftDisabled += await enableMovedVshudAutomations(userDataPath, cutover.migrationId, enable)
  }
  return leftDisabled
}

async function enableOnce(
  userDataPath: string,
  migrationId: string,
  enable: EnableServerAutomation
): Promise<number> {
  const cutover = listVshudMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  const ids = cutover?.automationsToEnableOnServer
  if (!cutover || !isRetainedVshudMigrationSourceCutover(cutover) || !ids?.length) {
    return 0
  }
  const moved = new Map(
    cutover.manifest.payload.dormantState?.automations?.map((entry) => [entry.id, entry])
  )
  const unreachable: string[] = []
  let leftDisabled = 0
  for (const id of ids) {
    const automation = moved.get(id)
    if (!automation) {
      continue
    }
    try {
      if (!(await enable(automation))) {
        leftDisabled += 1
      }
    } catch (error) {
      console.warn('[ssh] Could not re-enable a moved automation on its server:', error)
      unreachable.push(id)
    }
  }
  const current = listVshudMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  if (current) {
    writeVshudMigrationSourceCutover(userDataPath, {
      ...current,
      automationsToEnableOnServer: unreachable
    })
  }
  return leftDisabled
}

// The server stores the moved row as sent; any later edit, ours included, changes updatedAt.
const ServerAutomationSchema = z.object({ automation: z.object({ updatedAt: z.number() }) })

/** Uses automation.show/update, which servers had before migrations; re-sending dtstart skips occurrences missed during the move. */
export async function enableRemoteVshudAutomation(
  pairingCode: string,
  automation: Automation,
  options: CatalogRequestOptions = {}
): Promise<boolean> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('vshud_migration_pairing_code_invalid')
  }
  try {
    const shown = await sendSupportedMigrationRequest(
      pairing,
      'automation.show',
      { id: automation.id },
      options
    )
    if (!shown.ok) {
      return false
    }
    const server = ServerAutomationSchema.safeParse(shown.result)
    if (!server.success) {
      return false
    }
    // A lost reply to our own update, or a user's edit on the server since: leave it as it is.
    if (server.data.automation.updatedAt !== automation.updatedAt) {
      return true
    }
    const updated = await sendSupportedMigrationRequest(
      pairing,
      'automation.update',
      { id: automation.id, updates: { enabled: true, dtstart: automation.dtstart } },
      options
    )
    return updated.ok
  } catch (error) {
    if (error instanceof Error && error.message === VSHUD_MIGRATION_DESTINATION_UNSUPPORTED) {
      return false
    }
    throw error
  }
}
