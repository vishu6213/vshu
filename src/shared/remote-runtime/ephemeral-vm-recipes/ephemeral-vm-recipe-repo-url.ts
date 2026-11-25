import { stripCredentialsFromMessage } from '../../git/remotes/git-remote-error'
import type { VshuVmRecipe } from '../../workspace-setup/vshu-yaml-hook-types'

export function getProvisionedRootRecipeRepoUrl(
  checkoutMode: VshuVmRecipe['checkoutMode'],
  remoteUrl: string | undefined
): string | undefined {
  if (checkoutMode !== 'provisioned-root' || !remoteUrl) {
    return undefined
  }
  return stripCredentialsFromMessage(remoteUrl)
}
