import type React from 'react'
import { Folder, Server, SquareTerminal, Terminal } from 'lucide-react'
import { Trans } from 'react-i18next'
import type {
  VshuUninstallAgentEntry,
  VshuUninstallPath,
  VshuUninstallPlan,
  VshuUninstallSimpleEntry,
  VshuUninstallStep
} from '../../../../../../shared/uninstall/vshu-uninstall-types'
import { isTuiAgent } from '../../../../../../shared/agent-launch/catalog/tui-agent-config'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { getAgentLabel } from '@/lib/agent-catalog/agent-catalog'
import { cn } from '@/lib/class-names'
import { i18n } from '@/i18n/i18n'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import { Button } from '../../../ui/button'
import { isVshuUninstallProblem } from './vshu-uninstall-plan-state'
import { getVshuUninstallSlotKind } from './VshuUninstallStatus'
import {
  ExpandableRow,
  isStepBusy,
  PATH_CLASS,
  RowSlot,
  SimpleRow,
  SUB_ROW_CLASS,
  SubRowSlot,
  useAutoExpand,
  type RowsModel
} from './VshuUninstallRowLayout'
import { VshuUninstallHostSubRows } from './VshuUninstallHostRows'
import { vshuUninstallRetryKey } from './use-vshu-uninstall'

/** "8 agents and 1 SSH host": what the hooks row covers, or null when only scripts are left. */
export function describeVshuUninstallHookTargets(
  plan: VshuUninstallPlan,
  t: Translate,
  intlLocale: string
): string | null {
  const targets: string[] = []
  if (plan.agents.length > 0) {
    targets.push(
      t('settings.uninstall.hookTargets.agents', '{{count}} agents', {
        count: plan.agents.length,
        defaultValue_one: '1 agent'
      })
    )
  }
  if (plan.hosts.length > 0) {
    targets.push(
      t('settings.uninstall.hookTargets.sshHosts', '{{count}} SSH hosts', {
        count: plan.hosts.length,
        defaultValue_one: '1 SSH host'
      })
    )
  }
  return targets.length === 0
    ? null
    : new Intl.ListFormat(intlLocale, { type: 'conjunction' }).format(targets)
}

const VISIBLE_AGENT_LOGOS = 7
function HookRows({ model }: { model: RowsModel }): React.JSX.Element | null {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const agents = model.plan?.agents ?? []
  const scripts = model.plan?.hookScripts ?? null
  const hosts = model.plan?.hosts ?? []
  const [expanded, toggle] = useAutoExpand(
    agents.some((entry) => isVshuUninstallProblem(entry.state)) ||
      (scripts !== null && isVshuUninstallProblem(scripts.state)) ||
      hosts.some((entry) => isVshuUninstallProblem(entry.state))
  )
  if (!model.plan || (agents.length === 0 && !scripts && hosts.length === 0)) {
    return null
  }
  const targets = describeVshuUninstallHookTargets(model.plan, t, intlLocale)
  const hidden = agents.length - VISIBLE_AGENT_LOGOS
  return (
    <>
      <ExpandableRow
        expanded={expanded}
        onToggle={toggle}
        label={
          <>
            <span>
              {targets
                ? t('settings.uninstall.rows.hooksIn', 'Hooks in {{targets}}', { targets })
                : t('settings.uninstall.rows.hookScripts', 'Hook scripts')}
            </span>
            <span className="flex items-center gap-1">
              {agents.slice(0, VISIBLE_AGENT_LOGOS).map((entry) => (
                <AgentIcon
                  key={entry.agent}
                  agent={isTuiAgent(entry.agent) ? entry.agent : null}
                  size={14}
                />
              ))}
              {hidden > 0 ? <span className="text-xs text-muted-foreground">+{hidden}</span> : null}
            </span>
          </>
        }
        slot={<RowSlot model={model} step={HOOK_STEPS} meta={null} />}
      />
      {expanded ? (
        <div className="pl-6">
          {agents.map((entry) => (
            <AgentSubRow key={entry.agent} model={model} entry={entry} />
          ))}
          {scripts ? <HookScriptsSubRow model={model} entry={scripts} /> : null}
          <VshuUninstallHostSubRows model={model} />
        </div>
      ) : null}
    </>
  )
}

function HookPath({ entry }: { entry: VshuUninstallPath }): React.JSX.Element {
  const t = useTranslate()
  if (!entry.vshuData) {
    return <span className="block">{entry.path}</span>
  }
  const place =
    entry.vshuData.kind === 'codex-account'
      ? t('settings.uninstall.path.codexAccount', 'Vshu-managed Codex account')
      : t('settings.uninstall.path.appData', 'Vshu app data')
  return (
    <span className="block" title={entry.path}>
      <span className="font-sans">{place}</span> · {entry.vshuData.relative}
    </span>
  )
}

function AgentSubRow({
  model,
  entry
}: {
  model: RowsModel
  entry: VshuUninstallAgentEntry
}): React.JSX.Element {
  const t = useTranslate()
  const agent = isTuiAgent(entry.agent) ? entry.agent : null
  const running =
    (model.runningStep === 'agent-hooks' && entry.state === 'present') ||
    model.retrying.has(vshuUninstallRetryKey('agent-hooks', entry.agent))
  const kind = getVshuUninstallSlotKind([entry.state], running)
  return (
    <div className={SUB_ROW_CLASS}>
      <AgentIcon agent={agent} size={14} />
      <span className="min-w-0 break-words">{agent ? getAgentLabel(agent) : entry.agent}</span>
      <span className={PATH_CLASS}>
        {entry.paths.map((path) => (
          <HookPath key={path.path} entry={path} />
        ))}
      </span>
      <SubRowSlot
        kind={model.phase === 'idle' ? 'blank' : kind}
        detail={entry.detail}
        action={
          model.phase === 'done' && entry.state === 'error' ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => model.retry({ step: 'agent-hooks', only: [entry.agent] })}
            >
              {t('settings.uninstall.retry', 'Retry')}
            </Button>
          ) : null
        }
      />
    </div>
  )
}

// The scripts are what the agents' hook entries run, and a host's step only turns its hooks off.
const HOOK_STEPS: readonly VshuUninstallStep[] = ['agent-hooks', 'hook-scripts', 'ssh-hosts']

function HookScriptsSubRow({
  model,
  entry
}: {
  model: RowsModel
  entry: VshuUninstallSimpleEntry
}): React.JSX.Element {
  const t = useTranslate()
  const kind = getVshuUninstallSlotKind([entry.state], isStepBusy(model, 'hook-scripts'))
  return (
    <div className={SUB_ROW_CLASS}>
      <Folder className="size-3.5 text-muted-foreground" />
      <span className="min-w-0 break-words">
        {t('settings.uninstall.rows.hookScripts', 'Hook scripts')}
      </span>
      <span className={PATH_CLASS}>{entry.location}</span>
      <SubRowSlot
        kind={model.phase === 'idle' ? 'blank' : kind}
        detail={entry.detail}
        action={
          model.phase === 'done' && entry.state === 'error' ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => model.retry({ step: 'hook-scripts' })}
            >
              {t('settings.uninstall.retry', 'Retry')}
            </Button>
          ) : null
        }
      />
    </div>
  )
}

function SimpleStepRow({
  model,
  step,
  entry,
  icon,
  label,
  mono,
  meta
}: {
  model: RowsModel
  step: VshuUninstallStep
  entry: VshuUninstallSimpleEntry | null
  icon: React.ReactNode
  label: React.ReactNode
  mono: boolean
  /** Shown before the run instead of the entry's location. */
  meta?: string
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!entry) {
    return null
  }
  const showRetry = model.phase === 'done' && entry.state === 'error' && !isStepBusy(model, step)
  return (
    <SimpleRow
      icon={icon}
      label={label}
      slot={
        <span className="flex items-center gap-2 justify-self-end">
          {showRetry ? (
            <Button variant="outline" size="xs" onClick={() => model.retry({ step })}>
              {t('settings.uninstall.retry', 'Retry')}
            </Button>
          ) : null}
          <RowSlot
            model={model}
            step={step}
            detail={entry.detail}
            meta={
              <span className={cn('break-all', mono && 'font-mono')}>{meta ?? entry.location}</span>
            }
          />
        </span>
      }
    />
  )
}

/** One row per part of the plan, in run order, with the same rules and inset as the card. */
export function VshuUninstallRows({ model }: { model: RowsModel }): React.JSX.Element | null {
  const t = useTranslate()
  const plan = model.plan
  if (!plan) {
    return null
  }
  return (
    <>
      <HookRows model={model} />
      <SimpleStepRow
        model={model}
        step="cli-command"
        entry={plan.cliCommand}
        icon={<Terminal className="size-3.5" />}
        label={
          plan.cliCommand ? (
            <Trans
              i18n={i18n}
              defaults={t(
                'settings.uninstall.rows.cliCommand',
                '<cmd>{{name}}</cmd> CLI on your PATH'
              )}
              values={{ name: plan.cliCommand.commandName }}
              components={{ cmd: <code className="font-mono text-xs" /> }}
            />
          ) : null
        }
        mono
      />
      <SimpleStepRow
        model={model}
        step="background-service"
        entry={plan.backgroundService}
        icon={<Server className="size-3.5" />}
        label={
          <Trans
            i18n={i18n}
            defaults={t('settings.uninstall.rows.service', '<cmd>vshu serve</cmd> server')}
            components={{ cmd: <code className="font-mono text-xs" /> }}
          />
        }
        mono={false}
      />
      <SimpleStepRow
        model={model}
        step="terminal-daemon"
        entry={plan.terminalDaemon}
        icon={<SquareTerminal className="size-3.5" />}
        label={t('settings.uninstall.rows.terminalDaemon', 'Terminal background process')}
        meta={t('settings.uninstall.closesTerminals', 'Open terminals will close.')}
        mono={false}
      />
    </>
  )
}
