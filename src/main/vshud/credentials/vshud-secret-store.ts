// Always report available to prevent plaintext fallback; throw on seal/unseal when the key is unavailable.
import type { SecretStore } from '../../../shared/secure-storage/secret-store'
import { sweepStaleRecordStaging } from './vshud-secret-key-record'
import {
  vshudSecretStatePath,
  resolveState,
  type VshudSecretStorePrepareOptions,
  type StoreState
} from './vshud-secret-key-resolution'
import { openVshudSecret, sealVshudSecret } from './vshud-secret-sealing'
import { describeVshudHostKeyGap } from './vshud-secret-protection-gap'

export type VshudSecretStore = SecretStore & {
  prepare(options: VshudSecretStorePrepareOptions): Promise<boolean>
}

export function createVshudSecretStore(
  log: (message: string) => void = (message) => console.warn(message)
): VshudSecretStore {
  let state: StoreState = { kind: 'pending' }
  const readyKey = (): Buffer => {
    if (state.kind === 'ready') {
      return state.key
    }
    throw new Error(
      state.kind === 'unavailable'
        ? state.message
        : 'vshud_secret_store_not_prepared — the headless secret store has not loaded its key yet'
    )
  }
  return {
    isEncryptionAvailable: () => state.kind !== 'plaintext',
    encryptString: (plainText) => sealVshudSecret(readyKey(), plainText),
    decryptString: (cipher) => openVshudSecret(readyKey(), cipher),
    describeProtectionGap: () => {
      switch (state.kind) {
        case 'ready':
          return state.gap
        case 'unavailable':
          return state.message
        case 'plaintext':
          return state.reason
        case 'pending':
          return "Vshu's headless server has not loaded its credential key yet."
      }
    },
    describeSealing: () => {
      switch (state.kind) {
        case 'ready':
          return { kind: 'host-key', warning: state.gap ?? describeVshudHostKeyGap(false) }
        case 'unavailable':
          return { kind: 'none', reason: state.message }
        case 'plaintext':
          return { kind: 'none', reason: state.reason }
        case 'pending':
          return {
            kind: 'none',
            reason: "Vshu's headless server has not loaded its credential key yet."
          }
      }
    },
    async prepare(next) {
      sweepStaleRecordStaging(vshudSecretStatePath(next))
      state = await resolveState(next, log)
      return state.kind === 'ready'
    }
  }
}
