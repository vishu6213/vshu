import { useEffect } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { LinkRoutingPreferenceDialogProvider } from './link-routing-preference-dialog'
import { useLinkRoutingPreferenceDialog } from './link-routing-preference-dialog-context'

function AskOnMount({ openLinksInAppDefault }: { openLinksInAppDefault: boolean }): null {
  const requestPreference = useLinkRoutingPreferenceDialog()
  useEffect(() => {
    void requestPreference({ url: 'https://github.com/vishu6213/vshu', openLinksInAppDefault })
  }, [openLinksInAppDefault, requestPreference])
  return null
}

function dialogFixture(openLinksInAppDefault: boolean) {
  return defineFixture({
    width: 640,
    render: () => (
      <div className="h-[280px] bg-background">
        <LinkRoutingPreferenceDialogProvider>
          <AskOnMount openLinksInAppDefault={openLinksInAppDefault} />
        </LinkRoutingPreferenceDialogProvider>
      </div>
    )
  })
}

export const openInVshu = dialogFixture(false)

export const keepInVshu = dialogFixture(true)
