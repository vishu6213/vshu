import { sha256 } from './sha256'

/** A vshu.yaml script's trust hash: SHA-256 hex of its trimmed text, as hosts compute it. */
export function hashVshuHookContent(content: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(content.trim())))
}

/** Pins "no shared setup": a create carrying it skips any setup the created branch adds. */
export const EMPTY_VSHU_HOOK_CONTENT_HASH = hashVshuHookContent('')

export function bytesToHex(view: Uint8Array): string {
  let hex = ''
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}
