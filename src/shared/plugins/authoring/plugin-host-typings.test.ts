import { describe, expect, it } from 'vitest'
import {
  authorTypingsDiagnostics,
  authorTypingsProgram
} from './plugin-author-typings.test-fixture'

// One contract, declared once and read by the frame, the worker and the components panel.
const PROTOCOL = `
export type Todo = { id: string; title: string; done: boolean }
declare module 'vshu' {
  interface PluginRequests {
    'todos.list': { input: { done?: boolean }; output: Todo[] }
    'todos.add': { input: { title: string }; output: Todo }
  }
  interface PluginPanelEvents {
    'todos.changed': { count: number }
  }
}
`

const FRAME_SCRIPT = `
import type { JsonValue } from 'vshu/host'
import type { Todo } from '../protocol'

const context = await vshu.host.call('workspace.readContext')
const branch: string | undefined = context?.branch
const shown: { delivered: boolean } = await window.vshu.host.call('notifications.show', { title: 'Hi' })
vshu.on('theme', ({ colorScheme }) => colorScheme satisfies 'light' | 'dark')
vshu.on('editor.flush', async () => {})
const doc = await vshu.document?.get()
if (doc?.content.kind === 'text') {
  await vshu.document?.applyEdit({ baseVersion: doc.version, content: { kind: 'text', text: '' } })
}
await vshu.files?.saveAs({ suggestedName: 'a.txt', data: new Uint8Array(1) })
// @ts-expect-error worker-only method
await vshu.host.call('terminal.sendText', { terminalId: 't', text: 'x' })
const saved: JsonValue | null = await vshu.storage.get('a')
const todos: Todo[] = await vshu.plugin.request('todos.list', { done: false }, { timeoutMs: 5000 })
vshu.plugin.on('todos.changed', ({ count }) => count satisfies number)
vshu.on('workspace.created', ({ branch }) => branch satisfies string)
// @ts-expect-error declared requests type their input
await vshu.plugin.request('todos.list', { done: 'no' })
// @ts-expect-error a declared request needs its input
await vshu.plugin.request('todos.add')
const loose: JsonValue = await vshu.plugin.request('undeclared.name')
// @ts-expect-error title is required
await vshu.host.call('notifications.show', {})
// @ts-expect-error params are strict
await vshu.host.call('workspace.readContext', { extra: true })
// @ts-expect-error unknown frame event
vshu.on('worktree.created', () => {})
export { branch, shown, saved, todos, loose }
`

const WORKER_MAIN = `
import type { Activate, VshuWorkerApi } from 'vshu/worker'
import type { Todo } from './protocol'
const activate: Activate = (vshu: VshuWorkerApi) => {
  const todos: Todo[] = []
  vshu.panels.handle('todos.list', async ({ done }, { panel, signal }) => {
    signal.throwIfAborted()
    vshu.log(panel.id + panel.surface)
    return todos.filter((todo) => done === undefined || todo.done === done)
  })
  vshu.panels.handle('todos.add', ({ title }) => {
    const todo = { id: String(todos.length), title, done: false }
    todos.push(todo)
    vshu.panels.post('todos.changed', { count: todos.length })
    return todo
  })
  // @ts-expect-error a handler answers with the declared output
  vshu.panels.handle('todos.add', () => ({ id: 1 }))
  // @ts-expect-error posts carry the declared payload
  vshu.panels.post('todos.changed', { count: 'many' })
  vshu.settings.onDidChange(({ key }) => void vshu.settings.get(key))
  vshu.commands.register('ping', async (_args, { signal }) => {
    const stored = await vshu.host.call('storage.get', { key: 'pings' }, { signal })
    await vshu.host.call('storage.set', { key: 'pings', value: [stored.value, { at: 1 }] })
    return (await vshu.host.call('storage.keys')).keys.length
  })
  vshu.events.on('workspace.created', (payload) => vshu.log(payload.path + payload.branch))
  vshu.events.on('agent.status.changed', ({ workspaceId, state, mainAgent }) => {
    const done: boolean = state === 'done' && mainAgent?.outcome === 'success'
    vshu.log(String(workspaceId ?? done))
  })
  // @ts-expect-error frame-only method
  void vshu.host.call('shell.openExternal', { url: 'https://example.com' })
  // @ts-expect-error unknown event
  vshu.events.on('worktree.created', () => {})
  // @ts-expect-error storage values are JSON
  void vshu.host.call('storage.set', { key: 'k', value: () => 1 })
  vshu.hooks.on('terminal.send', (event, next) => {
    if (event.text.includes('rm -rf /')) {
      return { deny: 'blocked' }
    }
    return next({ ...event, text: event.text.trim() })
  })
  vshu.hooks.on('workspace.create.after', async ({ path }) => vshu.log(path))
  // @ts-expect-error a deny carries its reason
  vshu.hooks.on('terminal.send', () => ({ deny: 1 }))
  // @ts-expect-error unknown hook
  vshu.hooks.on('terminal.write', () => {})
}
export default activate
`

const COMPONENTS_PANEL = `
import { atom, Button, read, Stack, update, host, plugin, settings, on } from 'vshu'
import type { Todo } from './protocol'
const count = atom(0)
const todos = atom<Todo[]>('todos', [], { persist: 'storage' })
void plugin.request('todos.add', { title: 'x' }).then((todo) => todo.title satisfies string)
plugin.on('todos.changed', ({ count }) => count satisfies number)
on('agent.status.changed', ({ state }) => state satisfies string)
void settings.get('apiUrl')
export default function Panel() {
  return (
    <Stack gap="md">
      <Button onPress={() => update(count, (n) => n + 1)}>{read(count) + read(todos).length}</Button>
      <Button onPress={() => void host.call('notifications.show', { title: 'x' })}>Notify</Button>
    </Stack>
  )
}
`

const PANEL_TEST = `
import { mockHost, mount, assert } from 'vshu/testing'
import Panel from './panel'
import type { Todo } from './protocol'
const done: Todo = { id: '1', title: 'x', done: true }
const host = mockHost({
  requests: { 'todos.list': () => [done], 'todos.add': ({ title }) => ({ ...done, title }) },
  storage: { todos: [] },
  settings: { apiUrl: 'https://example.com' }
})
const panel = await mount(Panel, { host })
await panel.post('todos.changed', { count: 1 })
await panel.emit('agent.status.changed', { workspaceId: null, paneKey: 'p', state: 'done', receivedAt: 1 })
// @ts-expect-error posts carry the declared payload
await panel.post('todos.changed', { count: 'one' })
assert.deepEqual(panel.persisted.storage, host.data().storage)
`

const EDITOR_TEST = `
import { assert, mockEditorHost } from 'vshu/testing'
const host = mockEditorHost({ text: 'a' }, { colorScheme: 'light' })
const doc = await host.vshu.document!.session({ debounceMs: 0 })
doc.change(doc.value + 'b')
host.conflictNext('outside')
await host.flush()
assert.equal(host.text, 'ab')
host.edits[0]?.refused satisfies string | undefined
host.dispose()
`

describe('author typings', () => {
  it('type-check a frame script, a worker main and a components panel', () => {
    const program = authorTypingsProgram({
      'protocol.ts': PROTOCOL,
      'panel/app.ts': FRAME_SCRIPT,
      'main.ts': WORKER_MAIN,
      'src/panel.tsx': COMPONENTS_PANEL,
      'src/protocol.ts': PROTOCOL,
      'src/panel.test.ts': PANEL_TEST,
      'editor/sync.test.ts': EDITOR_TEST
    })
    expect(authorTypingsDiagnostics(program)).toEqual([])
  })
})
