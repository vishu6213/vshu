let listener: (environmentId: string) => void | Promise<void> = () => {}

export function setManagedVshudPairingRepairedListener(
  next: (environmentId: string) => void | Promise<void>
): void {
  listener = next
}

export function notifyManagedVshudPairingRepaired(environmentId: string): void | Promise<void> {
  return listener(environmentId)
}
