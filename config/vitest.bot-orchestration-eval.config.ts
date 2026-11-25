import { defineConfig } from 'vitest/config'

// Real agent CLIs as bots; never part of the unit run. Knobs: VSHU_BOT_EVAL_AGENT (claude|codex),
// VSHU_BOT_EVAL_RUNS, VSHU_BOT_EVAL_CONCURRENCY, VSHU_BOT_EVAL_ONLY (scenario ids),
// VSHU_BOT_EVAL_OUT (report file; transcripts beside it), VSHU_BOT_EVAL_MIN_PASS_RATE,
// VSHU_BOT_EVAL_VSHU_CHECKOUT (required: a clean vshu checkout bots may read; edits to it fail the thread),
// VSHU_BOT_EVAL_MODEL (pins the agent's model; the report names it and the CLI version).
// Needs zsh as the login shell, as the automation eval does.
export default defineConfig({
  test: {
    include: ['src/cli/bot-orchestration-eval/*.eval.ts'],
    environment: 'node',
    fileParallelism: false,
    // One zone for the grader, the stand-in and the agents, so schedules read the same everywhere.
    env: { TZ: 'America/New_York' },
    retry: 0
  }
})
