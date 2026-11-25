/** Managed launches alone enable idle exit and name the activation fence that keeps updates/rollbacks alive.
 * Dependency-free so the vshud launcher can read it. */
export const VSHUD_MANAGED_ACTIVATION_ROOT_ENV = 'VSHU_VSHUD_MANAGED_ACTIVATION_ROOT'

/** Host login env naming a machine's own managed-server data on a shared home; clones copy /etc/machine-id. */
export const VSHU_MACHINE_NAME_ENV = 'VSHU_MACHINE_NAME'
