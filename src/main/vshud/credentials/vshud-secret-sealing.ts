import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { ORIGINAL_BRAND_NAME } from '../../../shared/branding/legacy-brand-names'

// Leading NUL keeps sealed files distinguishable from legacy plaintext credentials.
const MAGIC = Buffer.from([0x00, 0x4f, 0x48, 0x01])
const IV_BYTES = 12
const TAG_BYTES = 16
// Pre-rebrand spelling: a different label derives a different key and strands every sealed secret.
const KEY_INFO = `${ORIGINAL_BRAND_NAME}-headless-secret-store/v1`
const KEY_CHECK_LABEL = `${ORIGINAL_BRAND_NAME}-headless-secret-store/check`

export const VSHUD_MASTER_KEY_BYTES = 32

/** Mix host binding into the key so a copied profile cannot unseal on another host. */
export function deriveVshudSealingKey(masterKey: Buffer, hostBinding: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, hostBinding, KEY_INFO, VSHUD_MASTER_KEY_BYTES))
}

/** Detect wrong keys without needing a sealed credential sample. */
export function vshudSealingKeyCheck(key: Buffer): string {
  return createHmac('sha256', key).update(KEY_CHECK_LABEL).digest('hex')
}

export function sealVshudSecret(key: Buffer, plainText: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(MAGIC)
  const body = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

export function openVshudSecret(key: Buffer, sealed: Buffer): string {
  const header = MAGIC.length + IV_BYTES + TAG_BYTES
  if (sealed.length < header || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('vshud_secret_not_sealed_by_this_host')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES)
  )
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(sealed.subarray(MAGIC.length + IV_BYTES, header))
  return Buffer.concat([decipher.update(sealed.subarray(header)), decipher.final()]).toString(
    'utf8'
  )
}
