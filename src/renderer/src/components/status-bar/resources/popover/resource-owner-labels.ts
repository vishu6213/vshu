import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export type ResourceOwnerKey = 'vshu' | 'agents' | 'yourProcesses'

export function resourceOwnerLabels(t: Translate = translate): Record<ResourceOwnerKey, string> {
  return {
    vshu: t('resourceManager.owner.vshu', 'Vshu'),
    agents: t('resourceManager.owner.agents', 'Agents'),
    yourProcesses: t('resourceManager.owner.otherTerminals', 'Other terminals')
  }
}
