import type { RuntimeAutomationController } from '../../integrations/automations/runtime-automation-controller'
import type { WebhookHostService } from '../../../webhooks/webhook-host-service'
import { VshuRuntimeWithOrchestrationDatabaseBinding } from './orchestration-database-binding'
import { vshuSignInServer } from '../../../bots/vshu-sign-in-server'

export abstract class VshuRuntimeWithWebhookOperations extends VshuRuntimeWithOrchestrationDatabaseBinding {
  private webhooks: WebhookHostService | null = null
  /** A serve or vshud host (session-window-graph.ts), whose signed-out copy names it. */
  abstract servesWithoutWindow: () => boolean

  /** This host's webhooks; null in `vshu serve` and in builds without cloud auth. */
  getWebhooks(): WebhookHostService | null {
    return this.webhooks
  }

  setWebhooks(webhooks: WebhookHostService | null): void {
    this.webhooks = webhooks
    this.automation.webhooks.set(webhooks)
    // A headless server's signed-out save refusal names it and how it signs in.
    this.automation.webhooks.signInServer = () => vshuSignInServer(this)
  }

  /** A connector event for a bot automation; null once the automation no longer takes it. */
  runAutomationForEvent(...args: Parameters<RuntimeAutomationController['runForEvent']>) {
    return this.automation.withExternalProbePriority(() => this.automation.runForEvent(...args))
  }
}
