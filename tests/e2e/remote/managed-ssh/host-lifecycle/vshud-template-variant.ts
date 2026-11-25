// Change only template build identity to model an app update bundling a newer vshud.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  VSHUD_TEMPLATE_MANIFEST_FILENAME,
  VSHUD_VERSION
} from '../../../../../src/shared/remote-runtime/vshud-distribution/vshud-artifacts'

const ENTRY = 'vshud.js'

/** Rewrites `templateDir` in place; its manifest keeps verifying. */
export function makeVshudTemplateVariant(templateDir: string, tag: string): void {
  const entry = path.join(templateDir, ENTRY)
  appendFileSync(entry, `\n// vshud e2e template variant ${tag}\n`)
  const manifestPath = path.join(templateDir, VSHUD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.commonSha256[ENTRY] = createHash('sha256').update(readFileSync(entry)).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The host's activation record, read the way a client reads it. */
export function readHostVshudActivation(exec: (command: string) => string): {
  active?: string
  previous?: string
  activeAppVersion?: string
} {
  return JSON.parse(exec('cat "$HOME/.vshu-remote/vshud-active.json"'))
}

export function isVshudFullVersion(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${VSHUD_VERSION}+`)
}
