import type { RuntimeNotifier } from './runtime-notifier-contract'
import { VshuRuntimeWithPtyController } from '../../terminal/lifecycle/vshu-runtime-pty-controller'

export abstract class RuntimeNotifierBinding extends VshuRuntimeWithPtyController {
  setNotifier(notifier: RuntimeNotifier | null): void {
    this.notifier = notifier
    if (notifier) {
      this.repositoryForkBackfill.start()
    }
  }

  protected countTerminalSideEffectConsumingClientEventListeners(): number {
    return this.clientEvents.countTerminalSideEffectConsumers()
  }
}
