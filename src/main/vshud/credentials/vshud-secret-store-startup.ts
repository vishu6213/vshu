import { join } from 'node:path'
import { prepareVshudSecretStore } from '../host-runtime/vshud-host-adapters'

export async function prepareVshudSecretStoreAndMigrate(userDataPath: string): Promise<void> {
  const { getSecretStore } = await import('../../../shared/secure-storage/secret-store')
  const { reportSecretProtectionGap } = await import('../../host/secret-protection-report')
  const { migratePlaintextCredentials, vshudCredentialRoot } =
    await import('./vshud-plaintext-credential-migration')
  // Keep sealing keys outside disposable VSHU_USER_DATA roots.
  if (await prepareVshudSecretStore(vshudCredentialRoot(), userDataPath)) {
    await migratePlaintextCredentials(getSecretStore())
  }
  reportSecretProtectionGap({ dataFile: join(userDataPath, 'vshu-data.json') })
}
