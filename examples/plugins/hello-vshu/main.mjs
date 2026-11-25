// Sample plugin runs in a lazily forked plain-Node worker; its default export receives commands, events and capability-gated host API.
export default function activate(vshu) {
  vshu.commands.register('hello-ping', async () => {
    const stored = await vshu.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await vshu.host.call('storage.set', { key: 'pings', value: count })
    // A string result is shown as-is in Vshu; objects are shown as JSON.
    return count === 1 ? 'Pong! First ping.' : `Pong! ${count} pings so far.`
  })

  vshu.events.on('workspace.created', async (payload) => {
    vshu.log(`${payload.kind} created: ${payload.workspaceId} at ${payload.path}`)
    await vshu.host.call('notifications.show', {
      title: 'Workspace created',
      body: payload.path
    })
  })

  vshu.events.on('agent.status.changed', (payload) => {
    vshu.log(`agent status: ${payload.state} in ${payload.workspaceId ?? 'unknown workspace'}`)
  })
}
