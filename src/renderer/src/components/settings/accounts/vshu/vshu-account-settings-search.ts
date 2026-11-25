import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../../search/settings-search-keywords'

export const getVshuAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.vshuAccount.account', 'Vshu account'),
    description: translate(
      'auto.components.settings.vshuAccount.searchDescription',
      'Sign in or out of the account used by Artifacts and Vshu Relay.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.vshuAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.vshuAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.vshuAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.vshuAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.vshuAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.vshuAccount.keywordRelay', 'relay'),
      ...translateSearchKeyword('auto.components.settings.vshuAccount.keywordCloud', 'cloud')
    ]
  }
])
