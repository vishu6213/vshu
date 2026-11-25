import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'

/** Whether Vshu may link Codex sessions between account homes and ~/.codex; absent means on. */
export function isCodexHistorySharedAcrossAccounts(
  settings: Pick<GlobalSettings, 'codexShareHistoryAcrossAccounts'>
): boolean {
  return settings.codexShareHistoryAcrossAccounts !== false
}
