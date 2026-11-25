export const VSHUD_PAIRING_REPAIR_FAILED_CODE = 'vshud_pairing_repair_failed'

export class VshudManagedPairingRepairFailedError extends Error {
  readonly code = VSHUD_PAIRING_REPAIR_FAILED_CODE
  constructor(reason: string) {
    super(
      `${VSHUD_PAIRING_REPAIR_FAILED_CODE}: the Vshu server on this host no longer accepts this ` +
        `computer, and Vshu couldn't pair with it again over SSH: ${reason}. Nothing on the host ` +
        `was stopped; its terminals can't be verified until Vshu pairs again. Connect again to retry.`
    )
    this.name = 'VshudManagedPairingRepairFailedError'
  }
}
