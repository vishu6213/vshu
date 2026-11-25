import { describe, expect, it } from 'vitest'

import { computeCodexTrustedHash as computeTrustedHash } from '../identity/codex-trust-identity'
import type { CodexTrustEntry } from '../toml/config-toml-trust'
import { ORIGINAL_BRAND_NAME } from '../../../../shared/branding/legacy-brand-names'

// Frozen form-1 fixture: codex-cli 0.159.3 hooks/list reported this Interrupt hash with timeout 3,
// for the command as the pre-rebrand build wrote it, so the brand is put back before hashing.
const VSHU_FORM_1_COMMAND =
  ': vshu-agent-hook-form=1; if [ -n "${VSHU_PANE_KEY-}" ] && [ -n "${VSHU_AGENT_HOOK_ROOT-}" ] && [ -f "${VSHU_AGENT_HOOK_ROOT-}/agent-hooks/codex-hook.sh" ]; then /bin/sh "${VSHU_AGENT_HOOK_ROOT-}/agent-hooks/codex-hook.sh" || :; elif [ -z "${VSHU_AGENT_HOOK_ROOT-}" ] && [ -n "${VSHU_PANE_KEY-}" ] && [ -n "${VSHU_AGENT_HOOK_PORT-}" ] && [ -f "${HOME-}/.vshu/agent-hooks/codex-hook.sh" ]; then /bin/sh "${HOME-}/.vshu/agent-hooks/codex-hook.sh" || :; else { command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :; fi'
const REAL_INTERRUPT_HASH =
  'sha256:78b430d1d7794c49e6d83a36964d4082d05ec72023ccc38244e97b8e08d054d2'

const INTERRUPT_ENTRY: CodexTrustEntry = {
  sourcePath: '/home/dev/.codex/hooks.json',
  eventLabel: 'interrupt',
  groupIndex: 0,
  handlerIndex: 0,
  command: VSHU_FORM_1_COMMAND.replaceAll('VSHU', ORIGINAL_BRAND_NAME.toUpperCase()).replaceAll(
    'vshu',
    ORIGINAL_BRAND_NAME
  ),
  timeoutSec: 3
}

describe('the managed Codex Interrupt hook', () => {
  it('reproduces the hash real Codex computed for the Interrupt hook', () => {
    expect(computeTrustedHash(INTERRUPT_ENTRY)).toBe(REAL_INTERRUPT_HASH)
  })
})
