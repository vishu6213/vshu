// COMPAT(wsl-bridge): removed when WSL runs as an vshud host.
import { buildAgentFeatureSkillInstallCommand as buildPinnedSkillInstallCommand } from '../../../../../shared/skills/installation/agent-feature-install-commands'
import {
  VSHU_CLI_SKILL_NAME,
  VSHU_LINEAR_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
} from './agent-feature-skill-names'

/** The interactive install, pinned to this build; also the update, since `add` re-copies. */
export function buildAgentFeatureSkillInstallCommand(skillNames: readonly string[]): string {
  return buildPinnedSkillInstallCommand(skillNames, { sourceCommit: VSHU_BUILD_COMMIT })
}

export const ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCHESTRATION_SKILL_NAME
])

export const VSHU_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  VSHU_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
])

export const VSHU_LINEAR_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  VSHU_LINEAR_SKILL_NAME
])
