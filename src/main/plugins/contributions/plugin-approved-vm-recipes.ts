import type { VshuVmRecipe } from '../../../shared/workspace-setup/vshu-yaml-hook-types'
import type { PluginService } from '../plugin-service'

export async function getApprovedPluginVmRecipes(
  pluginService?: PluginService
): Promise<VshuVmRecipe[]> {
  if (!pluginService) {
    return []
  }
  await pluginService.whenReady()
  return pluginService.contentPacks.vmRecipes.list().map(({ recipe }) => recipe)
}
