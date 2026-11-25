import type { BridgeRpcClientOptions } from '../client-state/bridge-rpc-client-contract'

// Expose only postMessage/onmessage, the common surface of Android’s injected listener and Swift’s document-start installer; the page cannot address the wider WebView.
export type VshuBridgePageChannel = {
  postMessage: (json: string) => void
  onmessage: ((event: { data: string }) => void) | null
}

// No channel is valid in a browser or bridge-disabled WebView; let the caller substitute rather than throw.
export function readVshuBridgePageChannel(): VshuBridgePageChannel | null {
  const scope: typeof globalThis & { vshuBridge?: VshuBridgePageChannel } = globalThis
  const channel = scope.vshuBridge
  if (channel === undefined || typeof channel.postMessage !== 'function') {
    return null
  }
  return channel
}

// One onmessage slot requires one page client; a second would silently steal the first client’s frames.
export function createVshuBridgePageTransport(
  channel: VshuBridgePageChannel
): Pick<BridgeRpcClientOptions, 'send' | 'onMessage'> {
  return {
    send: (json) => {
      channel.postMessage(json)
    },
    onMessage: (handler) => {
      channel.onmessage = (event) => {
        handler(event.data)
      }
      return () => {
        channel.onmessage = null
      }
    }
  }
}
