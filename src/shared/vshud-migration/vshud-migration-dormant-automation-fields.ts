import {
  optionalFinite,
  optionalNullableString,
  requiredBoolean,
  requiredFinite,
  requiredRecord,
  requiredString,
  requiredStringOrEmpty
} from './vshud-migration-dormant-value-validation'

export function parsePrecheck(value: unknown): void {
  if (value === null) {
    return
  }
  const record = requiredRecord(value, 'vshud_migration_dormant_automation_precheck_invalid')
  requiredString(record.command, 'vshud_migration_dormant_automation_precheck_command_invalid')
  requiredFinite(
    record.timeoutSeconds,
    'vshud_migration_dormant_automation_precheck_timeout_invalid'
  )
}

export function parseOutputSnapshot(value: unknown): void {
  if (value === null) {
    return
  }
  const record = requiredRecord(value, 'vshud_migration_dormant_automation_output_invalid')
  if (record.format !== 'plain_text') {
    throw new Error('vshud_migration_dormant_automation_output_format_invalid')
  }
  requiredStringOrEmpty(record.content, 'vshud_migration_dormant_automation_output_content_invalid')
  requiredFinite(record.capturedAt, 'vshud_migration_dormant_automation_output_time_invalid')
  requiredBoolean(record.truncated, 'vshud_migration_dormant_automation_output_truncated_invalid')
}

export function parsePrecheckResult(value: unknown): void {
  if (value === null) {
    return
  }
  const record = requiredRecord(value, 'vshud_migration_dormant_automation_precheck_result_invalid')
  requiredString(
    record.command,
    'vshud_migration_dormant_automation_precheck_result_command_invalid'
  )
  optionalFinite(
    record.exitCode,
    'vshud_migration_dormant_automation_precheck_result_exit_invalid',
    true
  )
  requiredBoolean(
    record.timedOut,
    'vshud_migration_dormant_automation_precheck_result_timeout_invalid'
  )
  requiredFinite(
    record.durationMs,
    'vshud_migration_dormant_automation_precheck_result_duration_invalid'
  )
  for (const field of ['stdout', 'stderr'] as const) {
    requiredStringOrEmpty(record[field], `vshud_migration_dormant_automation_${field}_invalid`)
    requiredBoolean(
      record[`${field}Truncated`],
      `vshud_migration_dormant_automation_${field}_truncated_invalid`
    )
  }
  optionalNullableString(
    record.error,
    'vshud_migration_dormant_automation_precheck_result_error_invalid'
  )
  requiredFinite(
    record.startedAt,
    'vshud_migration_dormant_automation_precheck_result_started_invalid'
  )
  requiredFinite(
    record.completedAt,
    'vshud_migration_dormant_automation_precheck_result_completed_invalid'
  )
}

export function parseUsage(value: unknown): void {
  if (value === null) {
    return
  }
  const record = requiredRecord(value, 'vshud_migration_dormant_automation_usage_invalid')
  if (record.status !== 'known' && record.status !== 'unavailable') {
    throw new Error('vshud_migration_dormant_automation_usage_status_invalid')
  }
  for (const field of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningOutputTokens',
    'totalTokens',
    'estimatedCostUsd'
  ] as const) {
    optionalFinite(record[field], `vshud_migration_dormant_automation_usage_${field}_invalid`, true)
  }
  requiredFinite(record.collectedAt, 'vshud_migration_dormant_automation_usage_collected_invalid')
}
