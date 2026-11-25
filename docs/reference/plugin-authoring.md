# Writing an Vshu plugin

From an empty folder to a plugin anyone can install from a catalog. The field-by-field rules
live in the generated references: [manifest](plugin-manifest.md), [catalog](plugin-catalog.md),
[host API](plugin-host-api.md), [themes](plugin-themes.md) and [theme tokens](plugin-theme-tokens.md),
[syntaxes](plugin-syntax.md). Listed plugins must follow the
[plugin listing policy](plugin-listing-policy.md).

## 1. Write

A plugin is a folder (in practice its own Git repository) with `vshu-plugin.json` at the root.
Start from one of these, or scaffold one with `vshu plugin create` (see [Validate](#3-validate)).
Add the `$schema` line from `vshu-gleam-syntax` to your manifest for editor completion.

| Example                               | Execution        | Shows                                                                                                                     |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `examples/plugins/vshu-gleam-syntax`  | `data`           | A syntax, no code                                                                                                         |
| `examples/plugins/hello-tsx`          | `sandboxed-ui`   | A [components](plugin-declarative-ui.md) TSX panel with no build step                                                     |
| `examples/plugins/hello-worker-panel` | `trusted-worker` | A TSX panel with its own worker, storage atom, settings and events ([Panels, workers and data](#panels-workers-and-data)) |
| `examples/plugins/hello-components`   | `sandboxed-ui`   | The same kind of [components](plugin-declarative-ui.md) panel, bundled first                                              |
| `examples/plugins/hello-vshu`         | `trusted-worker` | A panel, a worker command and events                                                                                      |

Leave `publisher` out. Vshu names the publisher after where the plugin comes from, the way a
[Go module path](https://go.dev/ref/mod#module-path) is its repository path: the owner of the
repository, lowercased (`acme` for `github.com/Acme/gleam-syntax`), so the plugin installs as
`acme.gleam-syntax`. Nobody can choose a publisher name that is not theirs.

| Installed from                    | Publisher                                                    |
| --------------------------------- | ------------------------------------------------------------ |
| The official or community catalog | the repository owner, set by the catalog in the entry's `id` |
| Another catalog                   | whatever that catalog's entry `id` says                      |
| A Git URL                         | the URL's owner (`.` and `_` become `-`)                     |
| A local or development folder     | `local`                                                      |

`publisher` is deprecated: Vshu ignores it for catalog and Git installs. Leaving it out needs
`engines.vshu` of at least `>=1.4.246`, because older Vshu requires the field and refuses a
value that differs from the catalog's. To keep supporting older Vshu, keep `publisher` and set it
to the repository owner; `validate:plugin` warns about it either way. An install made before
1.4.246 keeps its key, approvals and data. A local or development folder that still declares
`publisher` keeps using it until you remove it.

When copying the Gleam example, also drop its `stablyai` publisher and `vshu-` id prefix: both are
reserved for Vshu's own plugins, as are owners named `official`, `anthropic`, `openai`, `github`
or starting with `vshu`.

Pick the lowest `execution` profile that covers what you contribute; it decides what the user is
asked to approve:

- `data`: themes, terminal themes, icon themes, syntaxes, translations. Installs in one click.
- `declarative`: commands that run Vshu actions, shortcuts, VM recipes. Reviewed before they
  are enabled.
- `sandboxed-ui`: panels and custom editors, in a sandboxed frame that talks to Vshu only
  through `window.vshu` (see [Frames](#frames-windoworca)) and can call only the host methods
  whose surfaces list `panel` or `editor`.
  Vshu's colors reach frame CSS as `--vshu-background`, `--vshu-foreground`, `--vshu-primary`
  and the rest of its [frame variables](plugin-theme-tokens.md#frame-css-variables), so they never
  collide with a frame's own variables.
- `trusted-worker`: `main` runs in a separate Node process and can call every host method its
  `capabilities` allow. There is no global switch for these full-access plugins: each one runs
  only after the user approves it on install. An enterprise policy to block full-access plugins
  may come later.

Set `engines.vshu` to the newest `Since` of any field you use, and `pluginApi` (currently `1`)
only when a panel or worker calls the host API.

### Frames: `window.vshu`

Before any plugin code runs, the frame shell defines a frozen `window.vshu`. It is the only
supported way to talk to Vshu; the messages underneath are internal and change without notice.

```js
vshu.api // { major: 1, minor: 2 }: the host API this Vshu implements
if (vshu.host.has('workspace.readContext')) {
  // Synchronous: is the method offered to this surface by this Vshu?
  const controller = new AbortController()
  try {
    const context = await vshu.host.call('workspace.readContext', {}, { signal: controller.signal })
  } catch (error) {
    // error.code, error.message, error.retryable, error.retryAfterMs (rate_limited only)
  }
}
const subscription = vshu.on('theme', ({ colorScheme }) => {})
subscription.dispose()
```

Two calls need a click or key press in the frame (they reject with `not_permitted` otherwise)
and work only in the desktop app (in browser clients `vshu.shell` and `vshu.files` are undefined and
`vshu.host.has` answers false):

```js
button.onclick = () => vshu.shell.openExternal('https://example.com/docs') // http:, https:, mailto:
// Vshu asks the person before a web host this plugin was not allowed; { opened: false } if they cancel.
const { status } = await vshu.files.saveAs({
  suggestedName: 'chart.png',
  mimeType: 'image/png',
  data: arrayBuffer
})
// status is 'saved' or 'cancelled' (the person closed the dialog). The plugin never learns the
// path, and the file is marked as downloaded so the OS warns before opening it. Any mimeType is
// accepted; the dialog filters by the suggested name's extension. Executable, script, installer,
// shortcut and disk-image types (.exe, .js, .sh, .app, .lnk, .iso…) are refused.
```

`vshu.locale` is Vshu's UI language as a BCP-47 tag (`navigator.language` follows the
operating system, not Vshu). `<input type="file">` opens the system file picker.

Methods, their surfaces and their errors are in the [host API reference](plugin-host-api.md).
Aborting the `signal` rejects the call with `cancelled`. Treat an error `code` you do not know as
`action_failed`. Params are strict: a field the running Vshu does not know is refused with
`invalid_params`, so check `vshu.host.has` or `vshu.api.minor` before using a newer one.

#### Files and assets

In the desktop app each plugin's frames run in their own isolated process, storage and origin,
`vshu-plugin-frame://<key>/`, served from your plugin folder. Load scripts, styles, images, fonts,
WASM and workers by relative URL (`<script src="lib/app.js">`, `new Worker('worker.js')`,
`WebAssembly.instantiateStreaming(fetch('lib/mod.wasm'))`), and `localStorage` and IndexedDB
persist per plugin. The network is closed: anything not in your plugin folder, `data:` or
`blob:` fails to load, whatever your own CSP says, and the frame makes no connections, requests or
DNS lookups of its own. Links to other pages in your folder navigate the frame; for anything else
use `vshu.shell.openExternal`, which needs a click and, for a web host your plugin has not opened
before, the person's OK in an Vshu prompt that shows the URL (they can always allow that host). A file that is a custom editor's
`entry` gets the editor API; every other HTML page gets the panel API.

With isolated frames, scripts may be TypeScript or JSX with no build step: `<script type="module"
src="app.tsx">` loads `app.tsx` transpiled, with its relative imports resolved, as described in
[No build step](plugin-declarative-ui.md#no-build-step). A panel or custom editor `entry` may itself
be a `.ts` or `.tsx` module (needs `engines.vshu` `>=1.4.246`); Vshu then serves a page that loads
it, with an empty `<div id="root">`. Only components panels get JSX for `vshu`; a frame that
uses JSX must bring its own runtime as relative files.

Browser clients (`vshu serve` in a web browser) still load a frame as one sandboxed document
with an opaque origin and `connect-src 'none'`: inline your scripts and styles, use `data:` URLs
for images and fonts, and do not rely on storage, workers or WASM loaded by URL there.

A worker's `main` module's **default export** is `activate(vshu)`, which Vshu calls once when the
worker starts; it may be `async`. A named `export function activate` is not called: the worker
fails to start with an error saying so.
An optional `export function deactivate()` runs (and is awaited) before the worker stops, for
flushing state; the worker may also stop when it has been idle for a while, and starts again on
its next command, event or panel request.

```ts
import type { VshuWorkerApi } from 'vshu/worker'

export default async function activate(vshu: VshuWorkerApi) {
  vshu.commands.register('hello', () => 'Hello from the worker')
}

export async function deactivate() {}
```

Workers get the same calls on the `vshu` object passed to `activate(vshu)`:
`vshu.api`, `vshu.host.call(method, params, { signal })`, `vshu.host.has(method)`, plus
`vshu.commands.register(id, (args, { signal }) => …)` and `vshu.events.on(event, handler)`, which
both return `{ dispose() }`, and the panel and data APIs in
[Panels, workers and data](#panels-workers-and-data). A command's `signal` aborts when Vshu stops waiting for it.
`vshu.log(message)` writes to `vshu plugin logs`. `vshu.grantedCapabilities` is the frozen list of
capability kinds the user approved (such as `['storage:own']`), fixed when the worker starts; the
host still checks each call. In `agent.status.changed`, `state` and `mainAgent.state` are one of `working`, `blocked`, `waiting`
and `done`. Every event's payload is in the [host API reference](plugin-host-api.md#events).

A worker command can take over one of Vshu's own actions with `"replaces": "<action>"` in
`contributes.commands` (the same actions a declarative `action` may name; `engines.vshu`
`>=1.4.248`). When that action fires from its shortcut, the palette or a menu, Vshu runs the
command instead; if the worker fails or has not answered within 2 seconds, Vshu runs its own. To
wrap Vshu's own, the command calls `vshu.host.call('commands.run', { action })`, which always
runs the built-in, never a replacement. The
person sees each replacement before approving the plugin and can switch it back on the plugin's
page. When two plugins replace the same action, the one installed first does, and the other's log
says so.

To test a handler without reproducing the real trigger, fire the event at a development plugin:

```sh
vshu plugin dev emit . workspace.created --data '{"workspaceId":"wt-1","kind":"worktree","path":"/repo","branch":"main"}'
```

It follows the normal rules: the plugin must be approved and granted the event's capability, and
`--data` is checked against the event's payload schema. The worker hears it when it lists the
event in `contributes.events` (it starts if it is not running), and each of the plugin's open
panels hears it once it has subscribed with `vshu.on(event, …)`; with neither, it is refused.
Installed plugins are refused. `--json` prints `{ pluginKey, event, delivered: { worker, panels } }`.
A handler's errors land in `vshu plugin logs` and `vshu plugin dev watch`.

To call a worker's `vshu.panels.handle(name, …)` handler without opening its panel, use
`vshu plugin dev request . <name> --data '<json>'`. It goes through the same path as a panel's
`plugin.request` (approved development plugin with `main`; the worker starts if needed) and
prints `{ pluginKey, name, result }`. A handler failure exits `1` with `plugin_request_failed` and
the worker's code (`unknown_method`, `timeout`, ...) in `error.data.requestCode`.

A worker's `main` is an ES module: `.js`/`.mjs`, or `.ts`/`.mts` with no build step (needs
`engines.vshu` `>=1.4.246`). Vshu transpiles TypeScript files in your plugin folder as Node loads
them, keeping line numbers, so stack traces point at your `.ts` lines; enums and parameter
properties work too. JSX does not (no `.tsx` worker files). Relative imports resolve as in frames:
`./util`, `./util.js` and `./util.ts` all find `util.ts`, and `./store` finds `store/index.ts`.
Everything else, such as `node:` builtins, resolves exactly as Node resolves it for a JavaScript
worker. `vshu/worker` holds only types, so import it with `import type`; a value import fails when
the worker starts.

A worker does not inherit Vshu's full environment: tokens, shell-rc variables and display variables
(`DISPLAY`, `WAYLAND_DISPLAY`) are withheld. It keeps `PATH`, `HOME`, locale and temp-dir
variables, plus `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS` and `SSH_AUTH_SOCK` from Vshu's launch
environment, so `git` credential helpers (such as libsecret) and ssh-agent can reach the session
Vshu started in. `GIT_TERMINAL_PROMPT=0` is set, so `git` fails instead of asking for a password.
This filter only keeps secrets held in Vshu's environment out of plugins; it is not a sandbox. A
worker runs as you and can read your files, saved logins and SSH keys like any other program.

### Panels, workers and data

A plugin's panels, custom editors and worker are one program. A panel asks its own worker, the
worker pushes back, and both read the same storage, settings and secrets (with the same
capabilities). Every surface spells it the same way: frames on `window.vshu`, components panels
as imports from `vshu`, workers on the `vshu` from `activate`.

Declare the contract once, in a file both sides include, and both type-check against it:

```ts
// src/protocol.ts
export {}
declare module 'vshu' {
  interface PluginRequests {
    'todos.list': { input: { done?: boolean }; output: Todo[] }
  }
  interface PluginPanelEvents {
    'todos.changed': { count: number }
  }
}
```

The worker answers and posts:

```js
export default function activate(vshu) {
  vshu.panels.handle('todos.list', async ({ done }, { panel, signal }) => list(done))
  // To every open panel of this plugin, or one: { panel: id } from a request's context.
  vshu.panels.post('todos.changed', { count: 3 })
}
```

A panel asks and listens (in a frame, the same methods are on `vshu.plugin`):

```ts
import { plugin } from 'vshu'
const todos = await plugin.request('todos.list', { done: false }, { timeoutMs: 5000 })
plugin.on('todos.changed', ({ count }) => {})
```

- `plugin.request` starts the worker if it is not running, so a panel-only plugin can keep its
  logic in a worker that runs only while someone uses it. It needs `main` (`trusted-worker`).
- It rejects with `unknown_method` when no handler has that name, `timeout` past `timeoutMs`
  (default 30 s, at most 120 s; the handler's `signal` aborts then, and when the panel closes),
  `unavailable` when the worker cannot start, or the `code` the handler threw (`invalid_params`,
  `conflict` and the other host error codes; anything else is `action_failed`).
- Inputs and answers are JSON: an input up to 64 KiB, an answer up to 1 MiB. Posts are fire and
  forget, up to 256 KiB each and 200 per 10 seconds per plugin.
- Only the same plugin's panels and worker can reach each other.

Storage, settings and secrets are the plugin's own, shared by every surface:

```ts
import { atom, storage, settings, secrets } from 'vshu'
await storage.set('filters', { done: false }) // storage:own
storage.onDidChange(({ key }) => {}) // any surface's write, the person's included
const url = await settings.get('apiUrl') // settings:own; declared ones read as their default
await secrets.set('token', value) // secrets:own
// A components atom kept in storage: the worker reads storage.get('todos') and its writes
// update the atom.
const todos = atom('todos', [], { persist: 'storage' })
```

Declare settings the person edits in `contributes.settings`; Vshu shows them under the plugin in
its Settings and checks every value against the declaration:

```json
"settings": [
  { "key": "apiUrl", "title": "Server URL", "type": "string", "default": "https://example.com" },
  { "key": "pageSize", "title": "Page size", "type": "integer", "default": 20, "minimum": 1 }
],
"capabilities": [{ "kind": "settings:own" }]
```

`type` is `string`, `number`, `integer` or `boolean`; `enum` (with `enumLabels`), `minimum`,
`maximum`, `maxLength`, `multiline` and `placeholder` shape the control. A setting needs the
`settings:own` capability, which is also how code reads it.

Panels hear workspace and agent events the same way workers do, with the same capability:
`on('agent.status.changed', handler)` needs `agent:read`, the workspace events `workspace:read`.
A panel needs no `contributes.events` entry for that; it subscribes while it is open.

To show the workspace's agents, list them once with `agents.list` (`agent:read`), then follow
`agent.status.changed`. Both name each agent's terminal with `terminalId`, the id
`workspace.readContext` lists (with each terminal's `title`) and `terminal.sendText` takes; an
event's `paneKey` is Vshu's own pane id. `workspace.changed` (`workspace:read`) carries the new
`workspace.readContext` answer whenever focus moves to another workspace or its terminals open,
close or are renamed, and once right when a panel or worker subscribes, so a panel never polls
and never starts out stale.

```ts
import { atom, host, on, read, set, update } from 'vshu'
const agents = atom<{ terminalId: string | null; title: string | null; state: string }[]>([])
export async function setup() {
  set(agents, (await host.call('agents.list')).agents)
  on('agent.status.changed', ({ terminalId, title, state }) =>
    update(agents, (list) => [
      { terminalId: terminalId ?? null, title: title ?? null, state },
      ...list.filter((agent) => agent.terminalId !== terminalId)
    ])
  )
  on('workspace.changed', async () => set(agents, (await host.call('agents.list')).agents))
}
```

### Custom editors

A custom editor opens files that end in one of its `extensions` (with the dot, such as
`.excalidraw`) or carry one of its exact `filenames` in the editor tab, beside Source. Syntaxes
match files the same way. It runs in the same sandboxed frame as a panel (no Node, no file system), and Vshu keeps
the buffer, dirty state, saving, the external-change banner, read-only tabs and remote (SSH or
paired host) files; the frame only gets the document, never a path. Editor and panel plugins are
trusted code, and an editor can read every file it opens, so install ones you trust.

Set `"frame": "isolated"` (needs `engines.vshu` `>=1.4.248`) for an editor that needs the
desktop app's isolated frame, such as one that loads a large library. Browser clients, and the
desktop app with isolated frames switched off, then never run it in the fallback frame: the file
opens in Source with "This editor needs the Vshu desktop app". The default, `any`, runs wherever
the client can.

An editor's `window.vshu` adds `document`. Most editors need only `session()`, which does the
document sync for you:

```js
const doc = await vshu.document.session({
  decode: (content) => parseScene(content.text), // default: the text itself
  encode: (scene) => ({ kind: 'text', text: serializeScene(scene) }), // default: plain text
  merge: (base, outside, mine) => mergeScenes(base, outside, mine), // optional
  debounceMs: 250 // optional, the default
})
render(doc.value) // the latest value, including changes Vshu has not accepted yet
doc.onReplace((scene) => render(scene)) // the file changed outside, or a conflict merged
onUserEdit((scene) => doc.change(scene)) // a no-op while doc.readOnly
await doc.flush() // send now; rejects with the refusal's code
```

`session()` resolves once Vshu has sent the theme, locale and first document, so start the editor
from it. It keeps one edit in flight and coalesces later changes, moves its baseline only when Vshu
accepts an edit, and never hands your own accepted edits back through `onReplace`. A refused edit
keeps your draft and rejects `flush()`. On `conflict` it calls `merge(base, outside, mine)` once,
where `base` is the last accepted value, and sends the result. Without `merge` the outside
document wins, since an agent may have written the file: the draft is dropped, `onReplace` gets
the outside value, and `flush()` rejects with `conflict`. Pass `merge` to keep both sides. With
`merge`, a write to the file on disk while the tab has unsaved edits also reaches the editor:
Vshu calls `merge(base, outside, mine)` with `base` the disk content those edits started from,
the tab keeps the merged result unsaved, and its Reload/Overwrite banner is not shown. This
applies to a local file open in one editor view; elsewhere, without `merge`, or when the editor
does not answer within a second, that banner decides. It answers Vshu's `editor.flush`
itself before a save. Bytes editors pass both `decode` and `encode`. Check `'session' in
vshu.document` to support older Vshu.

Vshu keeps no undo history for a custom editor: Cmd/Ctrl+Z reaches the frame, and the editor owns
undo.

The lower-level calls, for an editor that does its own sync:

```js
const doc = await vshu.document.get() // { version, readOnly, content, fileType? }
// The current document right away, then each one Vshu sends when the file changes outside the editor.
vshu.document.onDidChange((doc) => render(doc))
await vshu.document.applyEdit({ baseVersion: doc.version, content: { kind: 'text', text } })
vshu.on('editor.flush', () => sendPendingEdit()) // before a save; Vshu waits for the promise
```

`content` is `{ kind: 'text', text }` for a text editor (the default `contentKind`). An edit is
the full new content, made against document `baseVersion`; send one only when the user changes
the document, never on load. `applyEdit` rejects with `conflict` when the file changed outside
the editor since that version (edit the newer document instead), `too_large` past the size cap,
and `not_permitted` when `readOnly` is true (an agent transcript, say). `version` rises with each
document Vshu sends, not with your own edits.

Set `"contentKind": "bytes"` for a binary format such as a spreadsheet. Vshu reads the file
itself (locally, over SSH or from a paired host) and the document's `content` is
`{ kind: 'bytes', bytes }`, where `bytes` is an `ArrayBuffer`, plus the matched suffix as
`fileType`. An edit is the whole new file the same way: `content: { kind: 'bytes', bytes }`.
Vshu marks the tab dirty and saves the bytes with the tab's normal save, replacing the file
atomically; a save is refused if the file changed on disk since the document's version, and the
banner offers Reload or Overwrite. Saving to a remote host needs an Vshu server new enough to
replace binary files. Source shows the binary placeholder, unsaved bytes are not kept across
restarts, and bytes tabs don't autosave.

Documents and edits are capped at 64 MiB, text or bytes, on every route (local, SSH and paired
hosts): a larger file shows "too large to open", and a larger edit is rejected with `too_large`.
Past 16 MiB the tab notes that the file may take a moment. Vshu saves on its own save shortcut pressed
inside the frame, never on a call alone.

Theme changes do not reload the frame: the shell updates the `--vshu-*` variables and the
`light`/`dark` class on `<html>` in place and emits `theme`. Restyle from the variables, or
listen with `vshu.on('theme', …)`, to follow it.

`vshu plugin check` (and `dev watch --check`) checks each custom editor without running it or
Vshu: from the `entry` it follows local `<script src>` files, inline module scripts and relative
imports, and fails at `file:line:column` on a syntax error (`editor_syntax`), a missing file
(`editor_missing_file`), an import Vshu refuses (`editor_import`) and a file over its limit
(`editor_too_large`). String `eval` or `Function`, which the frame refuses, is a warning
(`editor_eval`): the scan can misread rare code. `--json` lists them under `editors`.

To test an editor's sync logic in Node, `mockEditorHost` from `vshu/testing` installs
`globalThis.vshu` with the real document API and `session()` over an in-memory file:

```ts
import { assert, mockEditorHost, test } from 'vshu/testing'

test('keeps an agent write', async () => {
  const host = mockEditorHost({ text: '{"elements":[]}' }) // or { bytes }, plus { readOnly, colorScheme }
  await import('./sync.ts') // your code calls vshu.document.session()
  host.replace('{"elements":[1]}') // an outside change
  host.conflictNext() // the next edit is refused with `conflict`
  await host.flush() // as a save does
  assert.equal(host.edits.length, 1) // every applyEdit, refused ones with `refused: code`
  host.setTheme('light')
  host.dispose()
})
```

### MCP servers

`contributes.mcpServers` gives the agents Vshu launches on a host your MCP servers, next to the
ones the user added themselves. Each one has a `name` and either a `url` (a remote server) or a
`command` with optional `args` and `env` (a local stdio server):

```json
"execution": "declarative",
"contributes": {
  "mcpServers": [
    { "name": "acme", "url": "https://mcp.acme.dev/mcp" },
    { "name": "acme-local", "command": "npx", "args": ["-y", "@acme/mcp-server"] }
  ]
}
```

- They appear in Settings → MCP servers under **From plugins**, on each host where the plugin is
  installed and enabled. The user picks the agents and workspaces each one is on for; the address
  and command stay yours.
- A server that asks for a sign-in gets Vshu's own sign-in, which every agent then uses. Don't put
  keys or tokens in the manifest: it is public, and `headers` aren't accepted.
- The servers are bound to the reviewed manifest, so changing one asks the user to approve the
  update again. Disabling or uninstalling the plugin removes them and signs them out.
- When a name is already taken on that host, Vshu gives yours a free one (`acme-2`).

## 2. Load it while you work

From the plugin folder, run:

```sh
vshu plugin dev watch .
```

It writes the TypeScript typings (`.vshu/types`), loads the folder into Vshu as a development
plugin, and stays running: it prints every line your panels, editors and worker log (console
errors arrive as `[frame] <file>:<line> <message>`, at the line in your source file), a
`↻ reloaded` line each time a save reloads the plugin, and status changes such as `errored` or
`invalid` with the error. If an edit asks for new access, it prints the
`vshu plugin dev reload <dir> --approve <fingerprint>` command to run from another terminal.
Ctrl-C unloads the folder (unless it was loaded before you started) and exits; press it again
to exit at once. With `--json` it prints one JSON object per line, with a `type` of `loaded`,
`log`, `reloaded`, `status`, `approval`, `check`, `shot`, `shot_skipped`, `warning`, `disconnected` or
`unloaded`, for coding agents. `--check` also runs `vshu plugin check` after the load and after each reload and
prints what each components panel drew or threw, with `file:line:col`; it reports a failure while
Vshu does not run the plugin (pending approval, errored, invalid), even when the panels render
(`ok` false, `checkOk` true, and `pluginStatus`). Like `vshu plugin check`,
it runs your code on this machine outside Vshu's sandbox, and it needs a local folder. When the first load needs approval and you run it in a terminal, it prints what the plugin
would be granted (execution, each capability, what it adds) and asks `Approve and load? [y/N]`;
`y` loads it with that approval and keeps watching. Any other answer, Ctrl-C, `--json`, or
output that is not a terminal (a coding agent, a pipe) fails like `vshu plugin dev load`: it
exits with code 3 and prints the command to re-run with `--approve` (with `--json`, as one line).
It never approves on its own. The re-run owns the folder the refused attempt added, so its
Ctrl-C unloads it.

### See the panel

`vshu plugin shot <plugin-key>` saves a PNG of a panel exactly as Vshu draws it, cropped to the
panel, to `.vshu/shots/<plugin-key>-<panel>.png` (or `--out <file>`): in the plugin folder when
you run it inside one (the nearest `vshu-plugin.json`, up to the repository root), else in the
current folder. It opens the panel in the
right sidebar, waits until the current code has drawn (a components panel's first tree, an HTML
panel's page loaded; up to 15 seconds) and, for a components panel, until its host calls such as
`plugin.request` have answered and redrawn (at most 3 seconds more), and captures it even while Vshu's window is hidden or
behind others, without showing, raising or focusing it. `--width <px>` sizes the panel for that
capture only. `--theme light|dark` paints Vshu in that mode for that capture only, and only while
its window is hidden or minimized: with the window on screen, the shot keeps the current theme
rather than repaint the app in front of you, and says so (`themeApplied: false` and a
`themeReason`). Your width and theme setting are always put back. `--json` prints `{ path, width,
height, theme, themeApplied, themeReason?, settled, errors, pendingRequests?, actions?,
restored? }`, where `errors` holds the error banner the panel shows and the errors it logged
during the capture, and `pendingRequests` counts host calls still unanswered (above 0, the image
may show the panel still loading). A coding agent reads the
image to see what it built.

`--act '<json>'` drives a components panel before the capture, with the test kit's verbs: a list
(at most 20) such as `[{"type":{"label":"New task"},"text":"Ship","submit":true},
{"press":{"text":"Add"}},{"select":{"label":"View"},"value":"done"},{"toggle":{"label":"Hide
done"}}]`, whose queries match like the kit's (`text`, `label`, `testId`, `type`, `role`). The
kit's Slider, Table and Tree verbs work too: `{"slide":Q,"value":7}`, `{"sort":Q,"column":"name"}`,
`{"selectRows":Q,"keys":["a"]}`, `{"activateRow":Q,"key":"a"}`, `{"loadMore":Q}`, and
`expand`, `collapse`, `selectItem`, `activateItem` with a `key`. Each act goes through Vshu's own
control, as your typing or click would, and waits for the panel to redraw and its host calls to
answer. `actions` in the result has one `{ ok, error? }` per act; the first failure skips the
rest, the PNG shows the panel at that point, and the command exits 1. Once captured, Vshu puts
the panel's atoms back, persisted ones included, so later shots and you see the panel as it was
(`restored: true`; false when it reloaded during the acts). What handlers did outside the panel
is not rolled back: a press whose handler sends `plugin.request('counter.add')` leaves the
worker's storage changed. It acts only on that
plugin's panel and only while Vshu's window is hidden or minimized, so it never clicks under you;
html panels refuse it. An act is not a person's press: a Link's href stays unopened and calls
that need a gesture (`shell.openExternal`, `files.saveAs`) are refused.

`vshu plugin shot <dir> --scenario <name>` shoots the panel in one scenario of its
`<entry>.check.ts` (see check fixtures) instead of the live panel. The CLI renders that scenario
the way `vshu plugin check` does, with the panel and its worker against a stand-in host, so the
scenario's data never reaches the plugin's real panel, storage, settings or worker. Vshu then
draws the resulting tree in a preview of its own, apart from the plugin, and captures it; the
right sidebar is not opened or switched. Like `vshu plugin check`, it runs the plugin's code on
your machine without Vshu's sandbox, so use it only on code you trust. Pass the plugin folder,
or a development plugin's key when you run it inside that folder; installed plugins are refused.
The result adds `replay: true` and `scenario`, `errors` lists what the render reported, and an
unknown name fails and lists the panel's scenarios. A replay is a still frame: controls whose
value Vshu owns start from the tree's props, images show their placeholder, it takes no `--act`,
it works only on this machine (no `--environment`), and it needs Vshu's window hidden or
minimized because the preview is drawn inside it. It writes
`.vshu/shots/<plugin-key>-<panel>.<scenario>.png` in the plugin folder unless you pass `--out`.

### See a custom editor

`vshu plugin shot <dir|plugin-key> --editor <file>` saves a PNG of the plugin's custom editor
showing that file. It opens the file as `vshu plugin open --editor` does: in the workspace that
holds it (its real path counts, so `/tmp/a.sketch` matches a workspace at `/private/tmp`), or else
it opens the file's folder as a folder workspace. It loads the editor afresh, waits until the
editor has its document and has asked for it (`vshu.document.get` or `vshu.document.onDidChange`)
and has painted, then captures exactly the editor, hidden window included. `--width` and
`--height` size the editor for that capture only, and `--theme` works as for panels; both are put
back afterwards. `--act '<json>'` sends real input to the editor first, in its own CSS pixels
from its top-left: `[{"click":[200,150]},{"drag":[[200,150],[400,300]]},{"key":"r"}]` (a `key`
takes a name such as `Enter` and optional `"modifiers":["shift"|"control"|"alt"|"meta"]`), each
painted before the next, and only while Vshu's window is hidden or minimized. A shot never
changes your file: with `--act` it copies the file into a temporary folder, shoots the copy in a
temporary folder workspace and removes both afterwards (`copy: true` in the result); pass
`--in-place` to act on the file itself, where edits reach its buffer like your own typing and its
tab stays open with them. Before each `key`, Vshu moves focus into the editor (what was focused,
or what the last click or drag hit), so a canvas that keeps focus to itself still gets the key.
Without `--act` it opens the file itself, leaves its buffer alone, and closes the tab if the shot
opened it.
The PNG is always written (`.vshu/shots/<plugin-key>-<editor>.png` unless `--out`), but the
command exits 1 and prints `errors` when the editor threw, was blocked by its content policy, or
never asked for its document within 5 seconds. `--json` prints `{ path, editorId, filePath, width,
height, theme, themeApplied, settled, subscribed, errors, acted?, copy? }`. Afterwards Vshu shows
the workspace it showed before.

### See what your plugin adds to Vshu's chrome

`vshu plugin shot <dir|plugin-key> --status-bar` saves a PNG of Vshu's status bar, where your
status bar items draw; `--window` saves the whole window. Both capture the hidden window like a
panel shot, without showing or focusing it, and take `--theme` (put back afterwards) and `--out`.
They write `.vshu/shots/<plugin-key>-status-bar.png` or `-window.png`. On Linux an html panel's
guest can come out blank in a `--window` shot; shoot the panel itself for it.

When no workspace is showing, a panel shot selects one of this machine's workspaces in the hidden
window first; it fails only when Vshu has none.

`vshu plugin dev watch . --shot ./.vshu/shots` opens one panel (the first, or
`--shot-panel <id>`) in the right sidebar once, then after the load and after each reload that
leaves the plugin running saves a fresh `<plugin-key>-<panel>.png` of it; with `--check`, the
check runs first. It never switches the sidebar again: while you show another tab or close the
sidebar it skips the shot and says so once (`shot_skipped`), and resumes when the panel is back.

`vshu plugin open <plugin-key> [--panel <id>]` shows a panel to you in the right sidebar, and
`--editor <file>` opens a file in the plugin's custom editor. It never brings the window forward.

Both need the Vshu desktop app with a workspace showing; `vshu serve` has no window and refuses
them. A shot never changes the view, so while Vshu shows Settings or another full page it fails
with `no_workspace`. With `--environment`, the PNG (at most 5 MiB) comes back to the machine
that ran the command.

To keep a folder loaded without a terminal, use Settings instead:

1. Settings → Plugins: click **Turn on plugins**.
2. **Development folders…** → add the plugin folder. It loads as `local.<id>` (or under its
   deprecated `publisher` while it still declares one), and overrides an installed copy with
   the same key.
3. Review and enable it. Nothing runs before that.

From a terminal (or a coding agent), `vshu plugin dev load <dir>` does the same. A content-only
plugin loads at once; anything that runs code fails with `approval_required`, which lists what it
would be granted and the command to re-run with `--approve <fingerprint>`. `vshu plugin logs
<publisher.id>` prints its logs and `vshu plugin dev unload <dir>` removes it.
`vshu plugin install <owner/repo[@ref]>` installs a published plugin the same way, with the Vshu
host's own Git credentials for private repositories, and `vshu plugin update` keeps it current.

Vshu watches development folders and reloads the plugin when its manifest or files change.
Theme, syntax and translation edits show up as you save. Panels and workers are not bound to
their files in development, so saving does not ask for approval again; adding a capability or
moving to a higher execution profile does. Shortcuts and recipes are tied to their files, so
each change to them is reviewed again. **Restart** on the plugin row restarts a worker by hand,
and the plugin's logs show what it printed. `vshu plugin dev reload [<dir>]` reloads
now, for a change the watcher missed (network or WSL folders) or after changing commands or
shortcuts, which need a new approval (`--approve <fingerprint>`).

A components panel hot reloads on save, keeping its keyed atoms and, when a save does not load,
its last good version with the error inline ([hot reload](plugin-declarative-ui.md#hot-reload)).
A running worker restarts on the new code; what it keeps in `storage` is on disk, so it survives
the restart, while its in-memory state does not.

For TypeScript, run `vshu plugin types <dir>` once (or let `vshu plugin dev load` do it): it
writes Vshu's typings and a tsconfig to extend into `.vshu/types/`, which ignores itself in Git.
They cover every surface: the components `vshu` module, the global `vshu` (`window.vshu`) of
panels and custom editors, and `import type { VshuWorkerApi } from 'vshu/worker'` for a worker's
`activate(vshu)` (in JavaScript, `/** @param {import('vshu/worker').VshuWorkerApi} vshu */`).
`vshu.host.call` checks each method's params and result, and only offers the methods your
surface may call; `vshu.events.on` types each [event payload](plugin-host-api.md#events).
Development folders skip every `.vshu/`, `.git/` and `node_modules/`, at any depth (such as a
nested `build/node_modules/`): they never count toward the size limits below, and editing them
never re-reviews the plugin or remounts its frames. An install still hashes every file it copies
except the root `.git/`, so do not commit them.

A plugin folder holds at most 2,000 files and 50 MiB in total. A panel or custom editor `entry`
is at most 10 MiB, and each `.ts`, `.tsx`, `.mts` or `.jsx` file Vshu transpiles at most 1 MiB;
bundle or split anything larger.

In the desktop app, a panel's or custom editor's `console.error` and `console.warn`, uncaught
exceptions and unhandled rejections (and a components panel's render or mount errors) also land
in `vshu plugin logs`, as `[frame] <file>:<line> <message>` with the path relative to the plugin
folder and stack traces shortened the same way. At most 20 such lines per plugin every 10 s are
kept; past that one notice is logged and the rest are dropped. Requests Vshu blocks (anything off the plugin's
own files, refused by the frame's network fence or content policy) do not count toward that:
they are logged once per kind and origin with a count, every 5 s and when the frame closes, such
as `[frame] blocked font-src https://unpkg.com (x48): plugin frames have no network`. `vshu plugin dev inspect
<publisher.id>` opens DevTools for each of the plugin's open frames.

## 3. Validate

```sh
pnpm validate:plugin path/to/plugin
# or, without an Vshu checkout:
vshu plugin validate path/to/plugin
```

`vshu plugin create <dir> --template <theme|terminal-theme|icon-theme|syntax|language-pack|editor|panel|components|worker-panel>`
scaffolds a plugin that passes these checks, and `vshu plugin inspect <dir>` shows what it would be
allowed to do and its content hash.

This runs the manifest checks Vshu runs, strictly: unknown keys, limits, contributions beyond the
execution profile, an `engines.vshu` too low for the fields used, and that every file the
manifest names (icon, panel and editor entries, themes, syntaxes, translations, templates)
exists inside the plugin and fits its size limit. On a catalog it also
checks that listed images exist and fit. It warns when the manifest still declares the deprecated
`publisher`, and, in a Git repository, when that value is not the owner of the `origin` remote.
Warnings do not fail the check. Run it in CI for the plugin and catalog repositories.

It also reads the host calls in the code the worker, panel and editor entries ship (their
imports and `<script src>` files, literal `vshu.host.call('name')` names only, as bundlers keep
them; comments are ignored). A call fails the check when this Vshu has no such method
(unreleased or misspelled), unless the plugin calls `vshu.host.has` anywhere, or when it is
still proposed, unless the plugin checks that name with a literal `vshu.host.has('name')`; then
it is a warning. A method newer than your
`engines.vshu` or one that surface cannot call is a warning, because a text scan cannot see
guards or which code a surface runs: raise `engines.vshu` to the release it names, or guard the
call with `vshu.host.has(name)`. Guards count plugin-wide, not per call. A deprecated method is
a warning starting `deprecated host method <name>`. The Vshu plugin directory runs this
against the latest Vshu release, so a method that release does not have holds your listing
until it ships, and it shows you the warnings. Each minor's first release is in the
[host API reference](plugin-host-api.md#stability-and-deprecation).

The two report failure with different exit codes. `pnpm validate:plugin` exits `0` when every
file is valid, `1` when any is invalid or missing, and `2` when no path is given.
`vshu plugin` commands exit `0` ok, `1` error (such as a missing path), `2` the plugin is
invalid (`plugin_invalid`), and `3` approval is needed.

## 4. List it in the Vshu plugin directory

1. `vshu plugin validate .` passes, and the plugin is committed and pushed to the GitHub
   repository whose owner matches `publisher`.
2. Commit the new `version` in `vshu-plugin.json`, then tag that commit and push the tag:
   `git tag -a v1.2.0 -m v1.2.0 && git push origin v1.2.0`.
3. Add the `vshu-plugin` topic to the repository: `gh repo edit <owner>/<repo> --add-topic vshu-plugin`.
4. Check its listing at `https://vshu.dev/plugins/<owner>/<repo>`.

## 5. Publish to a catalog

A catalog is a Git repository with `vshu-catalog.json` at its root that lists plugins and pins
each release to an exact commit and file hash, so Vshu refuses bytes the catalog did not vouch
for. Plugins in Vshu's official and community catalogs must follow the
[plugin listing policy](plugin-listing-policy.md), starting with being free to install and use.

1. Commit the plugin and run `vshu plugin release-entry .` in its directory (or
   `pnpm validate:plugin path/to/plugin` from an Vshu checkout). It prints the
   release entry for `HEAD`: version, full commit SHA, `contentHash`, execution profile, minimum
   Vshu, contribution summary, capabilities and file types, plus the `source.path` when the plugin
   is a subdirectory of its repository. Every field must match
   what Vshu finds at install, so paste it rather than writing it by hand. Uncommitted changes are
   not part of the entry.
2. Add or update the plugin's entry in the catalog's `vshu-catalog.json`, newest release first:

   ```json
   {
     "id": "acme.gleam-syntax",
     "source": {
       "kind": "git",
       "url": "https://github.com/acme/vshu-gleam-syntax.git",
       "ref": "main"
     },
     "categories": ["languages"],
     "releases": [{ "...": "the printed entry" }]
   }
   ```

   The `id` is `<publisher>.<manifest id>`. In your own catalog you choose the publisher; use the
   repository owner, as the official and community catalogs do.

   `commit` must be a full 40-character SHA. A tag or branch name is refused by validation and
   skipped by Vshu. Keep the previous release listed when you raise `engines.vshu`, so older
   Vshu still has something to install.

   **One repository can hold many plugins.** Put each in its own directory, such as
   `plugins/gleam-syntax/vshu-plugin.json`, and add `"path": "plugins/gleam-syntax"` to its
   `source`; validating that directory prints the `path` to use. Vshu installs only that
   directory, and its `contentHash` covers only its files, so commits to sibling plugins never
   change it. Moving a plugin to another directory counts as a different repository.

3. Run `pnpm validate:plugin path/to/catalog` and regenerate the older
   `vshu-marketplace.json` as described in the [catalog reference](plugin-catalog.md#clients-before-format-2).
4. Users add the catalog under Settings → Plugins → ⋯ → **Catalog sources…** with its Git URL and ref.

Users approve a plugin once per level of access. An update from the same repository that asks
for nothing new, code changes included, installs without asking again and stays enabled. Vshu
asks again, listing what is new, when an update adds a capability, raises the execution profile,
adds a command, shortcut, panel or event subscription, ships virtual machine recipes, or comes from
a different repository.

With **Update plugins automatically** on (the default), Vshu installs such updates for enabled
catalog plugins by itself, checking at startup and every 6 hours. A release installs only once it
has been listed for 12 hours, or at once from the official catalog, so a takedown has time to land.
Only pinned catalog releases (a `releases` entry with its commit and content hash) install by
themselves; a listing without one updates only when the user clicks Update. This includes
full-access plugins: an update that asks for nothing new runs its new code with the access the user
already granted, the same way an editor's extensions update. Turn the setting off to review every
update. An update that needs approval is not installed: the current version keeps running and the
plugin shows **Update needs review**.

## Planned contribution points

These `contributes` keys are reserved: a manifest may list them only as empty arrays until
their format ships. Each is planned as declared data that Vshu renders and enforces, not
arbitrary plugin UI:

- `taskSources`: issue and task providers such as Asana, Linear or Jira, filled by a worker.
- `connections`: account providers with a host-run sign-in.
- `agentHarnesses`: new coding-agent harnesses described as data.
- `sidebarCards`: declarative left-sidebar cards whose values a worker updates.
- `skills`: agent skills shipped as files.
- `hooks`: agent lifecycle hooks for the agents Vshu launches.

`skills` and `hooks` will mean what they mean in agent-plugin formats such as Claude Code's. Vshu does not reserve `agents`, because those formats use it for subagent files.

See [the manifest reference](plugin-manifest.md#planned-contribution-points) for details.

## Stability

Plugins are in Alpha: the manifest v2 format and catalog format are stable contracts; items
listed as experimental may change. These parts are stable and change only additively:

- manifest format 2, capability names and execution profiles;
- host API 1 (`"pluginApi": 1`): method names, params, results, surfaces and error codes;
- the frame API `window.vshu` (`api`, `host.call`, `host.has`, `on`, `shell.openExternal`,
  `files.saveAs`, and `document` in custom editors) and the document `version`/`content` shape;
- theme token names, and theme ids once published (users' settings store them);
- catalog format 2 (`vshu-catalog.json`).

Experimental; these may still change without a new format:

- the `agent.status.changed` payload: `paneKey` is not yet a terminal id `terminal.sendText`
  accepts;
- the worker process model: Node version, lifecycle and the channel to Vshu. Only
  `activate(vshu)` and `vshu.api`, `vshu.host`, `vshu.commands`, `vshu.events` and `vshu.log` are
  promised,
  and workers may be stopped at any time;
- language-pack keys, which change when Vshu's source moves or its English copy changes; packs
  get best-effort coverage per release;
- `pnpm validate:plugin` output; only its exit codes (`0` valid, `1` invalid, `2` usage, see
  [Validate](#3-validate)) are stable;
- `settings:own`, which stores untyped values until plugins can declare settings;
- manifest format 1, which is deprecated. Catalogs need format 2.

Data folders, `vshu-plugin-image://` URLs, tab keys and the `pluginRoot` a worker receives are
internal.
