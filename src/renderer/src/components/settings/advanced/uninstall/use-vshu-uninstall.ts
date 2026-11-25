import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  VshuUninstallFinishAction,
  VshuUninstallPlan,
  VshuUninstallRunStepArgs,
  VshuUninstallStep
} from '../../../../../../shared/uninstall/vshu-uninstall-types'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import {
  markVshuUninstallStepFailed,
  mergeVshuUninstallStepResult,
  runVshuUninstallSteps,
  shouldRemoveHookScriptsAfterAgentRetry
} from './vshu-uninstall-plan-state'

export type VshuUninstallPhase = 'idle' | 'running' | 'done'

export type VshuUninstallModel = {
  plan: VshuUninstallPlan | null
  loadFailed: boolean
  phase: VshuUninstallPhase
  runningStep: VshuUninstallStep | null
  /** `step` or `step:id` keys with a retry in flight. */
  retrying: ReadonlySet<string>
  start: () => void
  retry: (args: VshuUninstallRunStepArgs) => void
  reload: () => void
  finish: (action: VshuUninstallFinishAction) => void
}

export function vshuUninstallRetryKey(step: VshuUninstallStep, id?: string): string {
  return id ? `${step}:${id}` : step
}

const failureDetail = (): string =>
  translate('settings.uninstall.stepFailed', 'Vshu could not finish this step.')

/** Loads the plan on mount (the collapsed summary names every part) and drives the step runner. */
export function useVshuUninstall(): VshuUninstallModel {
  const mountedRef = useMountedRef()
  const [plan, setPlan] = useState<VshuUninstallPlan | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [phase, setPhase] = useState<VshuUninstallPhase>('idle')
  const [runningStep, setRunningStep] = useState<VshuUninstallStep | null>(null)
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set())
  const planRef = useRef<VshuUninstallPlan | null>(null)

  const applyPlan = useCallback((next: VshuUninstallPlan): void => {
    planRef.current = next
    setPlan(next)
  }, [])

  const reload = useCallback((): void => {
    setLoadFailed(false)
    window.api.vshuUninstall.getPlan().then(
      (next) => {
        if (mountedRef.current) {
          applyPlan(next)
        }
      },
      (error) => {
        console.error('[uninstall] failed to read the uninstall plan:', error)
        if (mountedRef.current) {
          setLoadFailed(true)
        }
      }
    )
  }, [applyPlan, mountedRef])

  useEffect(() => {
    reload()
  }, [reload])

  const start = useCallback((): void => {
    const initial = planRef.current
    if (!initial || phase !== 'idle') {
      return
    }
    setPhase('running')
    void runVshuUninstallSteps(
      initial,
      (args) => window.api.vshuUninstall.runStep(args),
      failureDetail(),
      (next, step) => {
        if (mountedRef.current) {
          applyPlan(next)
          setRunningStep(step)
        }
      }
    ).then(() => {
      if (mountedRef.current) {
        setPhase('done')
      }
    })
  }, [applyPlan, mountedRef, phase])

  const retry = useCallback(
    (args: VshuUninstallRunStepArgs): void => {
      const run = (stepArgs: VshuUninstallRunStepArgs): void => {
        const keys = stepArgs.only?.map((id) => vshuUninstallRetryKey(stepArgs.step, id)) ?? [
          vshuUninstallRetryKey(stepArgs.step)
        ]
        setRetrying((prev) => new Set([...prev, ...keys]))
        const fold = (update: (current: VshuUninstallPlan) => VshuUninstallPlan): void => {
          if (mountedRef.current && planRef.current) {
            // Into the latest plan, since retries can finish out of order.
            applyPlan(update(planRef.current))
          }
        }
        window.api.vshuUninstall
          .runStep(stepArgs)
          .then(
            (next) => {
              fold((current) => mergeVshuUninstallStepResult(current, next, stepArgs))
              // The run kept the scripts for the agent that failed; now nothing uses them.
              if (
                stepArgs.step === 'agent-hooks' &&
                mountedRef.current &&
                planRef.current &&
                shouldRemoveHookScriptsAfterAgentRetry(planRef.current)
              ) {
                run({ step: 'hook-scripts' })
              }
            },
            (error) => {
              console.error(`[uninstall] retry of ${stepArgs.step} failed:`, error)
              fold((current) => markVshuUninstallStepFailed(current, stepArgs, failureDetail()))
            }
          )
          .finally(() => {
            if (mountedRef.current) {
              setRetrying((prev) => new Set([...prev].filter((key) => !keys.includes(key))))
            }
          })
      }
      run(args)
    },
    [applyPlan, mountedRef]
  )

  const finish = useCallback((action: VshuUninstallFinishAction): void => {
    window.api.vshuUninstall.finish(action).catch((error) => {
      console.error(`[uninstall] finish(${action}) failed:`, error)
      toast.error(translate('settings.uninstall.finishFailed', 'Vshu could not do that.'))
    })
  }, [])

  return { plan, loadFailed, phase, runningStep, retrying, start, retry, reload, finish }
}
