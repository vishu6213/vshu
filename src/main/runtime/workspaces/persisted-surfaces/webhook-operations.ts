import type { RuntimeAutomationController } from '../../integrations/automations/runtime-automation-controller'
import type { WebhookHostService } from '../../../webhooks/webhook-host-service'
import { VshuRuntimeWithOrchestrationDatabaseBinding } from './orchestration-database-binding'

export abstract class VshuRuntimeWithWebhookOperations extends VshuRuntimeWithOrchestrationDatabaseBinding {
  private webhooks: WebhookHostService | null = null

  /** This host's webhooks; null in `vshu serve` and in builds without cloud auth. */
  getWebhooks(): WebhookHostService | null {
    return this.webhooks
  }

  setWebhooks(webhooks: WebhookHostService | null): void {
    this.webhooks = webhooks
    this.automation.webhooks.set(webhooks)
  }

  /** A connector event for a bot automation; null once the automation no longer takes it. */
  runAutomationForEvent(...args: Parameters<RuntimeAutomationController['runForEvent']>) {
    return this.automation.withExternalProbePriority(() => this.automation.runForEvent(...args))
  }
}
