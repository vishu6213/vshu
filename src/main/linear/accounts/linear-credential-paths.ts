import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LEGACY_WORKSPACE_ID = 'legacy'

function getVshuDir(): string {
  return join(homedir(), '.vshu')
}

function getLegacyTokenPath(): string {
  return join(getVshuDir(), 'linear-token.enc')
}

export function getLegacyViewerPath(): string {
  return join(getVshuDir(), 'linear-viewer.json')
}

export function getWorkspaceFilePath(): string {
  return join(getVshuDir(), 'linear-workspaces.json')
}

export function getWorkspaceTokenDir(): string {
  return join(getVshuDir(), 'linear-tokens')
}

export function getWorkspaceTokenPath(workspaceId: string): string {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    return getLegacyTokenPath()
  }
  return join(getWorkspaceTokenDir(), `${Buffer.from(workspaceId).toString('base64url')}.enc`)
}

// The login Connect Linear hands this Mac, next to the workspace's API key.
export function getWorkspaceLoginPath(workspaceId: string): string {
  return join(getWorkspaceTokenDir(), `${Buffer.from(workspaceId).toString('base64url')}.login.enc`)
}

export function ensureVshuDir(): void {
  const dir = getVshuDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function ensureWorkspaceTokenDir(): void {
  const dir = getWorkspaceTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
