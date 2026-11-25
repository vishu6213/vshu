import { build } from 'esbuild'
import { join } from 'node:path'
import { VSHUD_LINEAR_SDK_ENTRY } from '../../../../src/shared/remote-runtime/vshud-distribution/vshud-artifacts.ts'
import { VSHUD_SERVER_BUILD_TARGET } from './vshud-entry-build.mjs'

// Bundle @linear/sdk into one CJS file for lazy require: copying would expose chunk names that change each release.
export async function stageVshudLinearSdk(root, outputDir) {
  await build({
    stdin: {
      contents: "module.exports = require('@linear/sdk')",
      resolveDir: root,
      sourcefile: 'vshud-linear-sdk-entry.js'
    },
    bundle: true,
    platform: 'node',
    target: VSHUD_SERVER_BUILD_TARGET,
    format: 'cjs',
    outfile: join(outputDir, VSHUD_LINEAR_SDK_ENTRY),
    minify: true,
    sourcemap: false,
    logLevel: 'error'
  })
}
