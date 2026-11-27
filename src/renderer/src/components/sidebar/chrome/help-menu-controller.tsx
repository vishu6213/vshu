import React, { useState } from 'react'
import { Keyboard, Loader2, RefreshCw, RotateCw, School } from 'lucide-react'
import { toast } from 'sonner'
import logo from '../../../../../../resources/logo.svg'
import { useAppStore } from '@/store/index'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useMountedRef } from '@/hooks/useMountedRef'
import { showOnboardingFromRenderer } from '../../onboarding/show-onboarding-event'
import { SetupGuideProgressRing } from '../../setup-guide/SetupGuideProgressRing'
import { useTranslate } from '@/i18n/use-translate'
import {
  getUpdateCheckClickOptions,
  getUpdateCheckHint
} from '@/app-shell/updates/update-check-click-options'

const NO_UPDATE_CHECK_MODIFIERS = {
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false
}

export type SetupMilestones = { done: number; total: number }

/** Help's Milestones row (opens the setup guide). `badge` shows done/total as text (the rail's account menu). */
export function MilestonesMenuItem({
  milestones,
  progress = 'ring'
}: {
  milestones: SetupMilestones
  progress?: 'ring' | 'badge'
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenuItem
      onSelect={() =>
        useAppStore.getState().openModal('setup-guide', { telemetrySource: 'help_menu' })
      }
    >
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        className="size-3.5 object-contain invert opacity-55 dark:invert-0"
      />
      {t('auto.components.sidebar.SidebarSettingsHelpMenu.f8a2c91d4e', 'Milestones')}
      {progress === 'badge' ? (
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground tabular-nums">
          {milestones.done}/{milestones.total}
        </span>
      ) : (
        <SetupGuideProgressRing
          done={milestones.done}
          total={milestones.total}
          sizeClassName="size-4"
          className="ml-auto"
        />
      )}
    </DropdownMenuItem>
  )
}

/** Help's menu rows, so the same Help can open from its own button or as a More submenu. */
export type HelpMenuController = {
  items: React.ReactNode
  dialog: React.ReactNode
  handleMenuOpenChange: (open: boolean) => void
}

/** `grouped`: links in one group, then updates + restart (the rail's account menu, which has its own groups above). */
export type HelpMenuDividers = 'default' | 'grouped'

export function useHelpMenuController(
  milestones: SetupMilestones | null,
  dividers: HelpMenuDividers = 'default'
): HelpMenuController {
  const t = useTranslate()
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const [isRestartingVshu, setIsRestartingVshu] = useState(false)
  const lastShowOnboardingAtRef = React.useRef(0)
  const updateCheckModifiersRef = React.useRef(NO_UPDATE_CHECK_MODIFIERS)
  const mountedRef = useMountedRef()
  const updateCheckHint = getUpdateCheckHint()

  const handleMenuOpenChange = (): void => {
    updateCheckModifiersRef.current = NO_UPDATE_CHECK_MODIFIERS
  }

  const handleShowOnboarding = (): void => {
    const now = Date.now()
    if (now - lastShowOnboardingAtRef.current < 500) {
      return
    }
    lastShowOnboardingAtRef.current = now
    void showOnboardingFromRenderer()
  }

  const handleRestartVshu = (): void => {
    if (isRestartingVshu) {
      return
    }
    setIsRestartingVshu(true)
    toast.info(t('auto.components.sidebar.SidebarSettingsHelpMenu.5161eef55d', 'Restarting Vshu…'))
    void window.api.app.restart().catch((error) => {
      if (mountedRef.current) {
        setIsRestartingVshu(false)
        toast.error(
          t('auto.components.sidebar.SidebarSettingsHelpMenu.4e8f5710d3', "Couldn't restart Vshu."),
          {
            description: error instanceof Error ? error.message : undefined
          }
        )
      }
    })
  }

  const openShortcutsSettings = (): void => {
    openSettingsTarget({ pane: 'shortcuts', repoId: null })
    openSettingsPage()
  }

  const handleCheckForUpdatesPointerDown = (event: React.PointerEvent): void => {
    updateCheckModifiersRef.current = {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    }
  }

  const handleCheckForUpdates = (): void => {
    const modifiers = updateCheckModifiersRef.current
    updateCheckModifiersRef.current = NO_UPDATE_CHECK_MODIFIERS
    void window.api.updater.check(getUpdateCheckClickOptions(modifiers))
  }

  // Dividers that only the standalone Help menu shows.
  const innerSeparator = dividers === 'default' ? <DropdownMenuSeparator /> : null

  return {
    items: (
      <>
        <DropdownMenuItem onSelect={openShortcutsSettings}>
          <Keyboard className="size-3.5" />
          {t('auto.components.sidebar.SidebarSettingsHelpMenu.e565171a7c', 'Keyboard Shortcuts')}
        </DropdownMenuItem>
        {innerSeparator}
        {milestones ? <MilestonesMenuItem milestones={milestones} /> : null}
        <DropdownMenuItem
          className="whitespace-nowrap"
          onClick={handleShowOnboarding}
          onSelect={handleShowOnboarding}
        >
          <School className="size-3.5" />
          {t('auto.components.sidebar.SidebarSettingsHelpMenu.b7e4d2a19c', 'Onboarding')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
          onPointerDown={handleCheckForUpdatesPointerDown}
          onSelect={handleCheckForUpdates}
          title={updateCheckHint}
        >
          {updateStatus.state === 'checking' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {t('auto.components.sidebar.SidebarSettingsHelpMenu.29c56f30ee', 'Check for Updates')}
        </DropdownMenuItem>
        {innerSeparator}
        <DropdownMenuItem onSelect={handleRestartVshu} disabled={isRestartingVshu}>
          <RotateCw className="size-3.5" />
          {t('auto.components.sidebar.SidebarSettingsHelpMenu.ad3d3ed7f1', 'Restart Vshu')}
        </DropdownMenuItem>
      </>
    ),
    dialog: null,
    handleMenuOpenChange
  }
}
