import type { SkillInstallDestination } from '../../../shared/skills/installation/skill-install-contract'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'

export async function classifySkillCloudInstallTarget(
  runtime: VshuRuntimeService,
  input: { environmentId?: string; destination: SkillInstallDestination }
): Promise<'local' | 'remote'> {
  return input.environmentId || (await runtime.skillInstallDestinationUsesSsh(input.destination))
    ? 'remote'
    : 'local'
}
