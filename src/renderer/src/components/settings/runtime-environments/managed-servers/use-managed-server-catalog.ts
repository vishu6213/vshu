import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { VshudManagedPendingMigrationRow } from '../../../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import {
  getVshudSshDeployment,
  type PublicKnownRuntimeEnvironment
} from '../../../../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { SshTarget } from '../../../../../../shared/remote-runtime/ssh/ssh-types'
import type { ManagedVshudPreloadApi } from '../../../../../../preload/api/runtime/managed-vshud-api'
import { useMountedRef } from '@/hooks/useMountedRef'
import { getManagedVshudApi } from '@/runtime/hosts/installation/managed-vshud-api-availability'
import { managedServerOutcomeLabel } from './managed-server-copy'

export type ManagedServerCatalog = {
  /** Absent in the web client, which can't reach SSH hosts. */
  api: ManagedVshudPreloadApi | undefined
  targets: SshTarget[]
  /** SSH hosts that don't already run, or move to, a managed server. */
  emptyTargets: SshTarget[]
  pending: VshudManagedPendingMigrationRow[]
  loadFailed: boolean
  resumingId: string | null
  reload: () => Promise<void>
  resume: (row: VshudManagedPendingMigrationRow) => Promise<void>
}

export function useManagedServerCatalog(
  environments: PublicKnownRuntimeEnvironment[],
  onChanged: () => void
): ManagedServerCatalog {
  const api = getManagedVshudApi()
  const mountedRef = useMountedRef()
  const [targets, setTargets] = useState<SshTarget[]>([])
  const [pending, setPending] = useState<VshudManagedPendingMigrationRow[]>([])
  const [resumingId, setResumingId] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const reload = useCallback(async () => {
    if (!api) {
      return
    }
    const [nextTargets, nextPending] = await Promise.all([
      window.api.ssh.listTargets(),
      api.listPendingMigrations()
    ])
    if (mountedRef.current) {
      setTargets(nextTargets)
      setPending(nextPending)
      setLoadFailed(false)
    }
  }, [api, mountedRef])

  useEffect(() => {
    void reload().catch(() => mountedRef.current && setLoadFailed(true))
  }, [mountedRef, reload])

  // Running or migrating servers already occupy the host.
  const busyTargetIds = new Set([
    ...environments.map((environment) => getVshudSshDeployment(environment)?.sshTargetId),
    ...pending.map((row) => row.sshTargetId)
  ])
  const emptyTargets = targets.filter(
    (target) => !target.vshudFence && !busyTargetIds.has(target.id)
  )

  const resume = async (row: VshudManagedPendingMigrationRow): Promise<void> => {
    if (!api || resumingId) {
      return
    }
    setResumingId(row.migrationId)
    try {
      const result = await api.convertSshHost({ sshTargetId: row.sshTargetId, name: row.name })
      if (result.outcome !== 'converted') {
        toast.message(managedServerOutcomeLabel(result))
      }
      onChanged()
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (mountedRef.current) {
        setResumingId(null)
      }
    }
  }

  return { api, targets, emptyTargets, pending, loadFailed, resumingId, reload, resume }
}
