import { useState } from 'react'
import { Copy, ExternalLink, Globe } from 'lucide-react-native'
import { ActionSheetModal, type ActionSheetAction } from '../../components/sheets/ActionSheetModal'
import { openExternalLink } from '../../platform/external-links/external-link'
import { useClipboardWriter } from '../../platform/clipboard/clipboard'
import { triggerError, triggerSuccess } from '../../platform/haptics/haptics'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'

// Choices for a tapped web link: Vshu's browser on the host, the phone's browser, or the clipboard.
export function MobileLinkActionSheet(props: {
  url: string
  // Called once the sheet has slid away; the URL stays on screen until then.
  onClose: () => void
  // Absent where a Vshu browser tab cannot open (floating workspace, or a host without streaming).
  openInVshu?: (url: string) => void
}): React.JSX.Element {
  const { url, onClose, openInVshu } = props
  const t = useMobileTranslation()
  const clipboard = useClipboardWriter()
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)
  const actions: ActionSheetAction[] = []
  if (openInVshu) {
    actions.push({
      id: 'openInVshu',
      label: t('session.linkActionSheet.openInVshu', 'Open in Vshu browser'),
      icon: Globe,
      closeBeforePress: true,
      onPress: () => openInVshu(url)
    })
  }
  actions.push(
    {
      // The phone's default browser, whichever the person set.
      id: 'openInBrowser',
      label: t('session.linkActionSheet.openInBrowser', 'Open in system browser'),
      icon: ExternalLink,
      closeBeforePress: true,
      onPress: () => openExternalLink(url)
    },
    {
      id: 'copyLink',
      label: copied
        ? t('common.copied', 'Copied')
        : t('session.linkActionSheet.copyLink', 'Copy link'),
      icon: Copy,
      onPress: () => {
        void clipboard.writeText(url).then(
          () => {
            triggerSuccess()
            setCopied(true)
          },
          () => triggerError()
        )
      }
    }
  )
  return (
    <ActionSheetModal
      visible={visible}
      title={url}
      actions={actions}
      onClose={() => setVisible(false)}
      onAfterClose={onClose}
    />
  )
}
