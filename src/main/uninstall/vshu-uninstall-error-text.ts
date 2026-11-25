/** The first line of an error, for one short row detail. */
export function vshuUninstallErrorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]
}
