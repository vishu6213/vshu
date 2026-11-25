import type {
  TransferVshuProfileProjectArgs,
  TransferVshuProfileProjectResult
} from '../../../shared/vshu-profiles/vshu-profiles'
import type { Store } from '../../persistence/loading-store/store'
import { transferVshuProfileProject } from './profile-project-transfer'
import { hasVshuProfileStateDatabase } from '../profile-storage-paths'
import './profile-project-move-intent'
import { profileHasPendingProjectMove } from './profile-project-move-record'
import { flushActiveProfileBeforeFileMutation } from '../storage/profile-persistence-deadline'

/** Keep the active Store stopped until file mutation either succeeds or proves unchanged. */
export async function transferActiveProfileProject(
  args: TransferVshuProfileProjectArgs,
  userDataPath: string,
  store: Pick<Store, 'beginProfileMaintenance'>,
  reopenSource: () => Promise<void>
): Promise<TransferVshuProfileProjectResult> {
  const hadDatabase = hasVshuProfileStateDatabase(args.sourceProfileId, userDataPath)
  const pendingMove = profileHasPendingProjectMove(args.sourceProfileId, userDataPath)
  const maintenance = await flushActiveProfileBeforeFileMutation(store, { flush: !pendingMove })
  let result: TransferVshuProfileProjectResult
  try {
    if (profileHasPendingProjectMove(args.sourceProfileId, userDataPath)) {
      throw new Error('active_source_vshu_profile_move_requires_recovery')
    }
    result = transferVshuProfileProject(args, userDataPath)
  } catch (error) {
    const needsRecovery =
      (!hadDatabase && hasVshuProfileStateDatabase(args.sourceProfileId, userDataPath)) ||
      profileHasPendingProjectMove(args.sourceProfileId, userDataPath)
    // Further writes would invalidate a retained move's recovery revision.
    await (needsRecovery ? reopenSource() : maintenance.resume())
    throw error
  }
  if (result.status !== 'transferred' || args.mode !== 'move') {
    await maintenance.resume()
  }
  return result
}
