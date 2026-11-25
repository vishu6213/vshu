import type * as core from './runtime-environment-managed-vshud-operations'
import { submitEnvironmentStoreCommand } from './runtime-environment-store-worker-client'

export async function addManagedVshudEnvironment(
  ...args: Parameters<typeof core.addManagedVshudEnvironment>
): Promise<ReturnType<typeof core.addManagedVshudEnvironment>> {
  const reply = await submitEnvironmentStoreCommand({
    operation: 'addManagedVshudEnvironment',
    args
  })
  if (reply.operation !== 'addManagedVshudEnvironment') {
    throw new Error('Unexpected environment store response')
  }
  return reply.value
}

export async function removeManagedVshudEnvironment(
  ...args: Parameters<typeof core.removeManagedVshudEnvironment>
): Promise<ReturnType<typeof core.removeManagedVshudEnvironment>> {
  const reply = await submitEnvironmentStoreCommand({
    operation: 'removeManagedVshudEnvironment',
    args
  })
  if (reply.operation !== 'removeManagedVshudEnvironment') {
    throw new Error('Unexpected environment store response')
  }
  return reply.value
}

export async function refreshManagedVshudPairing(
  ...args: Parameters<typeof core.refreshManagedVshudPairing>
): Promise<ReturnType<typeof core.refreshManagedVshudPairing>> {
  const reply = await submitEnvironmentStoreCommand({
    operation: 'refreshManagedVshudPairing',
    args
  })
  if (reply.operation !== 'refreshManagedVshudPairing') {
    throw new Error('Unexpected environment store response')
  }
  return reply.value
}

export async function moveManagedVshudLocalPort(
  ...args: Parameters<typeof core.moveManagedVshudLocalPort>
): Promise<ReturnType<typeof core.moveManagedVshudLocalPort>> {
  const reply = await submitEnvironmentStoreCommand({
    operation: 'moveManagedVshudLocalPort',
    args
  })
  if (reply.operation !== 'moveManagedVshudLocalPort') {
    throw new Error('Unexpected environment store response')
  }
  return reply.value
}

export async function recordManagedVshudMigration(
  ...args: Parameters<typeof core.recordManagedVshudMigration>
): Promise<ReturnType<typeof core.recordManagedVshudMigration>> {
  const reply = await submitEnvironmentStoreCommand({
    operation: 'recordManagedVshudMigration',
    args
  })
  if (reply.operation !== 'recordManagedVshudMigration') {
    throw new Error('Unexpected environment store response')
  }
  return reply.value
}
