import type React from 'react'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { VshuUninstallStep } from '../../../../../../shared/uninstall/vshu-uninstall-types'
import { cn } from '@/lib/class-names'
import { getVshuUninstallStepStates } from './vshu-uninstall-plan-state'
import {
  getVshuUninstallSlotKind,
  VshuUninstallStatusIcon,
  type VshuUninstallSlotKind
} from './VshuUninstallStatus'
import { vshuUninstallRetryKey, type VshuUninstallModel } from './use-vshu-uninstall'

/** Row grids and slots shared by every part of the uninstall list, so status icons line up. */
export const ROW_CLASS =
  'grid min-h-10 w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 text-left text-[13px]'
export const SUB_ROW_CLASS =
  'grid min-h-[30px] grid-cols-[14px_104px_minmax(0,1fr)_auto] items-center gap-2.5 text-settings-detail'
export const META_CLASS = 'justify-self-end text-right text-xs text-muted-foreground'
export const PATH_CLASS = 'break-all py-1.5 font-mono text-2xs text-muted-foreground'

export type RowsModel = Pick<
  VshuUninstallModel,
  'plan' | 'phase' | 'runningStep' | 'retrying' | 'retry'
>

export function isStepBusy(model: RowsModel, step: VshuUninstallStep): boolean {
  if (model.runningStep === step) {
    return true
  }
  const prefix = vshuUninstallRetryKey(step)
  return [...model.retrying].some((key) => key === prefix || key.startsWith(`${prefix}:`))
}

/** Before the run a row shows what it will remove; from then on the slot shows progress. */
export function RowSlot({
  model,
  step,
  meta,
  detail
}: {
  model: RowsModel
  /** Several steps when one row stands for all of them. */
  step: VshuUninstallStep | readonly VshuUninstallStep[]
  meta: React.ReactNode
  detail?: string | null
}): React.JSX.Element {
  const plan = model.plan
  if (model.phase === 'idle' || !plan) {
    return <span className={META_CLASS}>{meta}</span>
  }
  const steps = typeof step === 'string' ? [step] : step
  const kind = getVshuUninstallSlotKind(
    steps.flatMap((each) => getVshuUninstallStepStates(plan, each)),
    steps.some((each) => isStepBusy(model, each))
  )
  return (
    <span className="flex justify-self-end">
      <VshuUninstallStatusIcon kind={kind} detail={detail} />
    </span>
  )
}

export function ExpandableRow({
  expanded,
  onToggle,
  label,
  slot
}: {
  expanded: boolean
  onToggle: () => void
  label: React.ReactNode
  slot: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        ROW_CLASS,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50'
      )}
    >
      <ChevronRight
        className={cn(
          'size-3.5 text-muted-foreground transition-transform',
          expanded && 'rotate-90'
        )}
      />
      <span className="flex min-w-0 flex-wrap items-center gap-2">{label}</span>
      {slot}
    </button>
  )
}

export function SimpleRow({
  icon,
  label,
  slot
}: {
  icon: React.ReactNode
  label: React.ReactNode
  slot: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={ROW_CLASS}>
      <span className="flex text-muted-foreground">{icon}</span>
      <span className="min-w-0">{label}</span>
      {slot}
    </div>
  )
}

export function SubRowSlot({
  kind,
  detail,
  action
}: {
  kind: VshuUninstallSlotKind
  detail: string | null
  action: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-2 justify-self-end">
      {kind === 'problem' ? action : null}
      <VshuUninstallStatusIcon kind={kind} detail={detail} />
    </span>
  )
}

export function useAutoExpand(hasProblem: boolean): [boolean, () => void] {
  // Null follows the rows: a list with a problem opens itself until the user toggles it.
  const [choice, setChoice] = useState<boolean | null>(null)
  const expanded = choice ?? hasProblem
  return [expanded, () => setChoice(!expanded)]
}
