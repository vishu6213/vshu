// The one switch for MCP servers in Vshu: off until the feature ships. `VSHU_MCP_SERVERS=1` turns it
// on for a dev build, vshud or `vshu serve`; read on every call so the host's own env decides.
import { McpServersError } from './mcp-servers-error'

export function isMcpServersFeatureEnabled(): boolean {
  return process.env.VSHU_MCP_SERVERS === '1'
}

export function assertMcpServersFeatureEnabled(): void {
  if (!isMcpServersFeatureEnabled()) {
    throw new McpServersError('mcp_servers_off', 'MCP servers aren’t turned on for this host.')
  }
}
