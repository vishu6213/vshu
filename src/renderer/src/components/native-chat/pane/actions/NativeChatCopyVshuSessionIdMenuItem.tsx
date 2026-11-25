import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'

export type CopyVshuIdMenuItemCopy = {
  label: string
  tooltip: string
  copied: string
  failed: string
}

// Module level: React Compiler can't lower try/catch/finally inside a component.
async function copyVshuId(
  resolveVshuSessionId: () => Promise<string | null>,
  copy: CopyVshuIdMenuItemCopy,
  onSettled: (() => void) | undefined
): Promise<void> {
  try {
    const vshuSessionId = await resolveVshuSessionId()
    if (vshuSessionId) {
      await window.api.ui.writeClipboardText(vshuSessionId)
      toast.success(copy.copied)
    } else {
      toast.error(copy.failed)
    }
  } catch {
    toast.error(copy.failed)
  } finally {
    onSettled?.()
  }
}

/** Copies an Vshu id the host resolves at click, `vshu_session_id:<id>`; null resolves as a failure. */
export function CopyVshuIdMenuItem({
  resolveVshuSessionId,
  copy,
  onSettled
}: {
  resolveVshuSessionId: () => Promise<string | null>
  copy: CopyVshuIdMenuItemCopy
  onSettled?: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem onSelect={() => void copyVshuId(resolveVshuSessionId, copy, onSettled)}>
          <Copy />
          {copy.label}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
        {copy.tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

/** Copies the chat's Vshu session ID from the host: `vshu_session_id:<root>`, which `/clear` keeps. */
export function NativeChatCopyVshuSessionIdMenuItem({
  resolveVshuSessionId
}: {
  resolveVshuSessionId: () => Promise<string | null>
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <CopyVshuIdMenuItem
      resolveVshuSessionId={resolveVshuSessionId}
      copy={{
        label: t('components.native-chat.contextMenu.copyVshuSessionId', 'Copy Vshu Session ID'),
        tooltip: t(
          'components.native-chat.contextMenu.vshuSessionIdTooltip',
          "Vshu's ID for this chat, separate from the agent CLI's own session ID. Agents use it to refer to each other through Vshu."
        ),
        copied: t(
          'components.native-chat.contextMenu.vshuSessionIdCopied',
          'Vshu session ID copied'
        ),
        failed: t(
          'components.native-chat.contextMenu.vshuSessionIdCopyFailed',
          'Unable to copy Vshu session ID'
        )
      }}
    />
  )
}
