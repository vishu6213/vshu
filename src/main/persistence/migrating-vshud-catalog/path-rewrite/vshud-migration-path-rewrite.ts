/** Rewrite differing source/destination paths, such as WSL via \wsl.localhost; SSH identity rewriting must preserve payload bytes. */
import type { VshudMigrationCatalogPayload } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { isRecord } from '../../../../shared/vshud-migration/vshud-migration-manifest-fields'
import {
  decodeSavedLocalPtyId,
  PTY_SESSION_ID_SEPARATOR
} from '../../../../shared/terminal/pty/lifecycle/pty-session-id-format'
import { parseWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import { rewriteWorktreeIdPath } from '../../../../shared/worktree/id'
import {
  VSHUD_MIGRATION_PATH_FIELDS,
  type VshudMigrationPathFieldKind,
  type VshudMigrationPathForm
} from './vshud-migration-path-fields'

export type VshudMigrationPathRewriter = {
  /** Must return anything it does not recognise as a source path unchanged. */
  path: (value: string, form: VshudMigrationPathForm) => string
}

export const IDENTITY_VSHUD_MIGRATION_PATH_REWRITER: VshudMigrationPathRewriter = {
  path: (value) => value
}

/** A rewritten copy; the input is never mutated. Throws when two keys of a record would merge. */
export function rewriteVshudMigrationPayloadPaths(
  payload: VshudMigrationCatalogPayload,
  rewriter: VshudMigrationPathRewriter
): VshudMigrationCatalogPayload {
  const copy = structuredClone(payload)
  // Stage/commit checks repeat identity exports; skip traversal when every path stays unchanged.
  if (rewriter === IDENTITY_VSHUD_MIGRATION_PATH_REWRITER) {
    return copy
  }
  for (const field of VSHUD_MIGRATION_PATH_FIELDS) {
    const map = (value: string): string =>
      rewriteVshudMigrationPathValue(value, field.kind, rewriter)
    visit(copy, parseFieldLocation(field.at), map)
  }
  return copy
}

type Step =
  | { type: 'prop'; name: string }
  | { type: 'items' }
  | { type: 'values' }
  | { type: 'keys' }

export function parseFieldLocation(at: string): Step[] {
  const steps: Step[] = []
  for (const token of at.match(/[^.[\]{}]+|\[\]|\{\}|\{key\}/g) ?? []) {
    steps.push(
      token === '[]'
        ? { type: 'items' }
        : token === '{}'
          ? { type: 'values' }
          : token === '{key}'
            ? { type: 'keys' }
            : { type: 'prop', name: token }
    )
  }
  return steps
}

function visit(node: unknown, steps: Step[], map: (value: string) => string): unknown {
  const [step, ...rest] = steps
  if (!step) {
    return typeof node === 'string' ? map(node) : node
  }
  if (step.type === 'items') {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        node[index] = visit(item, rest, map)
      })
    }
    return node
  }
  if (!isRecord(node)) {
    return node
  }
  if (step.type === 'prop') {
    if (Object.hasOwn(node, step.name)) {
      node[step.name] = visit(node[step.name], rest, map)
    }
    return node
  }
  if (step.type === 'values') {
    for (const key of Object.keys(node)) {
      node[key] = visit(node[key], rest, map)
    }
    return node
  }
  renameKeys(node, map)
  return node
}

function renameKeys(node: Record<string, unknown>, map: (value: string) => string): void {
  const keys = Object.keys(node)
  const entries = keys.map((key) => [map(key), node[key]] as const)
  if (entries.every(([key], index) => key === keys[index])) {
    return
  }
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error('vshud_migration_path_rewrite_key_collision')
  }
  for (const key of Object.keys(node)) {
    delete node[key]
  }
  for (const [key, value] of entries) {
    node[key] = value
  }
}

/** One value of `kind`; anything the rewriter doesn't recognise comes back unchanged. */
export function rewriteVshudMigrationPathValue(
  value: string,
  kind: VshudMigrationPathFieldKind,
  rewriter: VshudMigrationPathRewriter
): string {
  switch (kind) {
    case 'worktree-id':
      return rewriteVshudMigrationWorktreeId(value, rewriter)
    case 'owner-key':
      return rewriteOwnerKey(value, rewriter)
    case 'pty-session-id':
      return rewritePtySessionId(value, rewriter)
    case 'editor-file-id':
      return rewriteEditorFileId(value, rewriter)
    case 'absolute':
    case 'maybe-absolute':
    case 'relative':
    case 'url':
      return rewriter.path(value, kind)
  }
}

export function rewriteVshudMigrationWorktreeId(
  value: string,
  rewriter: VshudMigrationPathRewriter
): string {
  return rewriteWorktreeIdPath(value, (path) => rewriter.path(path, 'absolute'))
}

function rewriteOwnerKey(value: string, rewriter: VshudMigrationPathRewriter): string {
  const scope = parseWorkspaceKey(value)
  if (scope?.type === 'folder') {
    return value
  }
  if (scope?.type === 'worktree') {
    const mapped = rewriteVshudMigrationWorktreeId(scope.worktreeId, rewriter)
    return mapped === scope.worktreeId ? value : `worktree:${mapped}`
  }
  return rewriteVshudMigrationWorktreeId(value, rewriter)
}

function rewritePtySessionId(value: string, rewriter: VshudMigrationPathRewriter): string {
  const physicalId = decodeSavedLocalPtyId(value)
  const prefix = physicalId === value ? '' : 'local|'
  const at = physicalId.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
  if (at <= 0) {
    return value
  }
  const owner = physicalId.slice(0, at)
  const mapped = rewriteOwnerKey(owner, rewriter)
  return mapped === owner ? value : `${prefix}${mapped}${physicalId.slice(at)}`
}

function rewriteEditorFileId(value: string, rewriter: VshudMigrationPathRewriter): string {
  const parts = value.split(':')
  if (parts[0] !== 'editor' || parts.length !== 4) {
    return rewriter.path(value, 'maybe-absolute')
  }
  let decoded: string[]
  try {
    decoded = parts.slice(1).map((part) => decodeURIComponent(part))
  } catch {
    return value
  }
  const [worktreeId, runtime, filePath] = decoded
  const mappedWorktreeId = rewriteVshudMigrationWorktreeId(worktreeId, rewriter)
  const mappedFilePath = rewriter.path(filePath, 'absolute')
  if (mappedWorktreeId === worktreeId && mappedFilePath === filePath) {
    return value
  }
  return ['editor', mappedWorktreeId, runtime, mappedFilePath]
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join(':')
}
