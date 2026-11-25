import { useState } from 'react'
import { BookOpen, Check, CircleUserRound, Files, Info, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useVshuProfileAuthStatusRefresh } from '@/components/vshu-profiles/use-vshu-profile-auth-status-refresh'
import { cn } from '@/lib/class-names'
import { translate } from '@/i18n/i18n'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { VshuProfileSignOutConfirmDialog } from '../../../vshu-profiles/VshuProfileSignOutConfirmDialog'
import { VshuSignInButton, VshuSignInWaitNotice } from '../../../vshu-profiles/VshuSignInProgress'
import { isVshuCloudConsoleAvailable } from '../../../../../../shared/vshu-cloud-console'
import {
  getDesktopReportingOrgIds,
  getVshuCloudTeamCapabilities
} from '../../../../../../shared/vshu-profiles/vshu-cloud-team-policy'
import { VshuConsoleRow } from './VshuConsoleRow'

export function accountStatusCopy(
  state: 'local' | 'unconfigured' | 'connected' | 'reconnect-required' | undefined,
  email: string | undefined,
  t: Translate = translate
): string {
  if (state === 'connected') {
    return email ?? t('auto.components.settings.vshuAccount.connected', 'Connected')
  }
  if (state === 'reconnect-required') {
    return t(
      'auto.components.settings.vshuAccount.reconnectRequired',
      'Your session expired. Sign in again to use cloud features.'
    )
  }
  if (state === 'unconfigured') {
    return t(
      'auto.components.settings.vshuAccount.unavailable',
      'Vshu sign-in is unavailable in this build.'
    )
  }
  if (state === 'local') {
    return t(
      'auto.components.settings.vshuAccount.signedOut',
      'Sign in to extend Vshu with cloud features, including Artifacts and Vshu Relay.'
    )
  }
  return t('auto.components.settings.vshuAccount.checking', 'Checking account status…')
}

function AccountBenefit({
  icon: Icon,
  title,
  description,
  className
}: {
  icon: typeof Files
  title: string
  description: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

/** An Vshu account's row: who it is, Connected, its status line, then the row's actions. */
export function VshuAccountHeader({
  name,
  connected,
  line,
  children
}: {
  name: string | undefined
  connected: boolean
  line: string
  children: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CircleUserRound className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">
            {name?.trim() || t('auto.components.settings.vshuAccount.account', 'Vshu account')}
          </p>
          {connected ? (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              <Check />
              {t('auto.components.settings.vshuAccount.connected', 'Connected')}
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{line}</p>
      </div>
      {children}
    </div>
  )
}

export function VshuAccountSettingsPane(): React.JSX.Element {
  const t = useTranslate()
  const locale = useIntlLocale()
  const authStatus = useAppStore((state) => state.vshuProfileAuthStatus)
  const signOut = useAppStore((state) => state.signOutCurrentVshuProfile)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const connected = authStatus?.state === 'connected'
  const canConnect = authStatus?.configured === true
  const teamCapabilities = getVshuCloudTeamCapabilities(authStatus)
  const policy = teamCapabilities?.teamPolicy
  const reportingOrgIds = getDesktopReportingOrgIds(teamCapabilities)
  const reportingTeams =
    authStatus?.organizations
      ?.filter(({ orgId }) => reportingOrgIds.includes(orgId))
      .map(({ name }) => name) ?? []
  const showReporting = reportingOrgIds.length > 0
  const reportingDetails = t(
    'auto.components.settings.vshuAccount.reportingDetails',
    'Device reporting details'
  )

  useVshuProfileAuthStatusRefresh()

  const confirmSignOut = async (): Promise<void> => {
    if (signingOut) {
      return
    }
    setSigningOut(true)
    const result = await signOut()
    setSigningOut(false)
    if (result) {
      setSignOutOpen(false)
    }
  }

  return (
    <>
      <div className="space-y-6">
        <VshuAccountHeader
          name={authStatus?.cloud?.displayName}
          connected={connected}
          line={accountStatusCopy(authStatus?.state, authStatus?.cloud?.email, t)}
        >
          {connected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={() => setSignOutOpen(true)}
            >
              {t('auto.components.settings.vshuAccount.signOut', 'Sign out')}
            </Button>
          ) : (
            <VshuSignInButton size="sm" disabled={!canConnect}>
              {authStatus?.state === 'reconnect-required'
                ? t('auto.components.settings.vshuAccount.signInAgain', 'Sign in again')
                : t('auto.components.settings.vshuAccount.signIn', 'Sign in to Vshu')}
            </VshuSignInButton>
          )}
          {connected ? null : <VshuSignInWaitNotice className="basis-full" />}
        </VshuAccountHeader>

        {policy && (
          <div className="flex items-center gap-1 text-settings-detail text-muted-foreground">
            <p>
              {t(
                'auto.components.settings.vshuAccount.managed',
                'Your team manages some Vshu settings.'
              )}
            </p>
            {showReporting && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={reportingDetails}
                  >
                    <Info aria-hidden className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  aria-label={reportingDetails}
                  className="w-80 max-w-[calc(100vw-2rem)]"
                >
                  <div className="space-y-2 p-3 text-sm">
                    <p>
                      {reportingTeams.length === reportingOrgIds.length
                        ? t(
                            'auto.components.settings.vshuAccount.deviceReportNamedViewers',
                            'Owners and admins at {{teams}} can view reports from this device.',
                            { teams: new Intl.ListFormat(locale).format(reportingTeams) }
                          )
                        : t(
                            'auto.components.settings.vshuAccount.deviceReportViewers',
                            'Team owners and admins can view reports from this device.'
                          )}
                    </p>
                    <p>
                      {t(
                        'auto.components.settings.vshuAccount.reportingDisclosure',
                        'The Devices view shows your Vshu version, release channel, device name, platform, update status, required plugins Vshu couldn’t install, and when the device last reported.'
                      )}
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}
        {isVshuCloudConsoleAvailable(authStatus) ? <VshuConsoleRow /> : null}

        <div className="space-y-4 border-t border-border/60 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {t('auto.components.settings.vshuAccount.benefitsTitle', 'Included with your account')}
          </p>
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2 md:gap-0 md:divide-x md:divide-border/60">
              <AccountBenefit
                icon={Files}
                className="md:pr-6"
                title={t('auto.components.settings.vshuAccount.artifactsTitle', 'Artifact sharing')}
                description={t(
                  'auto.components.settings.vshuAccount.artifactsDescription',
                  'Publish HTML and Markdown files, then manage every shared link from Vshu.'
                )}
              />
              <AccountBenefit
                icon={Smartphone}
                className="md:pl-6"
                title={t('auto.components.settings.vshuAccount.relayTitle', 'Vshu Relay')}
                description={t(
                  'auto.components.settings.vshuAccount.relayDescription',
                  'Connect Vshu Mobile to this desktop across cellular or any Wi-Fi.'
                )}
              />
            </div>
            {/* Put the third benefit below at full width so it cannot squeeze the existing pair. */}
            <AccountBenefit
              icon={BookOpen}
              className="border-t border-border/60 pt-5"
              title={t('auto.components.settings.vshuAccount.skillsTitle', 'Skill sharing')}
              description={t(
                'auto.components.settings.vshuAccount.skillsDescription',
                'Share one skill or a whole set behind an unlisted link, and install them on any machine you use.'
              )}
            />
          </div>
        </div>
      </div>

      <VshuProfileSignOutConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onConfirm={() => void confirmSignOut()}
        signingOut={signingOut}
      />
    </>
  )
}
