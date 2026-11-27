import { ShortcutKeyCombo } from '../../ui/ShortcutKeyCombo'
import type { ShortcutKeyComboDetails } from '@/lib/keyboard/useShortcutLabel'
import logo from '../../../../../../resources/logo.svg'
import { useTranslate } from '@/i18n/use-translate'

export type LandingShortcutItem = {
  id: string
  shortcut: ShortcutKeyComboDetails
  action: string
}

export const LANDING_ACTION_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-full border border-border/80 bg-secondary/75 px-4.5 py-2 text-sm font-medium text-foreground cursor-pointer hover:bg-accent transition-colors'

export function LandingBrand(): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <div
        data-vshu-landing-emblem=""
        className="relative flex size-22 items-center justify-center rounded-3xl border border-border/80 bg-card/85 shadow-lg shadow-black/60"
      >
        <img
          src={logo}
          alt={t('auto.components.Landing.520304a067', 'Vshu logo')}
          className="size-13"
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          {t('auto.components.Landing.6ca6ff404e', 'VSHU')}
        </h1>
      </div>
    </>
  )
}

export function LandingShortcutList({
  shortcuts
}: {
  shortcuts: readonly LandingShortcutItem[]
}): React.JSX.Element {
  return (
    <div
      data-vshu-landing-shortcuts=""
      className="mt-5 w-full max-w-xs space-y-2 rounded-2xl border border-border/70 bg-card/55 px-4 py-3.5"
    >
      {shortcuts.map((shortcut) => (
        <div key={shortcut.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span className="text-sm text-muted-foreground">{shortcut.action}</span>
          <ShortcutKeyCombo
            keys={shortcut.shortcut.keys}
            doubleTap={shortcut.shortcut.doubleTap}
            separatorClassName="mx-0.5 text-[10px] text-muted-foreground"
          />
        </div>
      ))}
    </div>
  )
}
