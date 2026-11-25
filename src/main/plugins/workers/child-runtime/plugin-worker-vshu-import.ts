// No `node:module` import here: `vshu plugin test` loads this on Node 20.6, which has no registerHooks.

export const isVshuSpecifier = (specifier: string): boolean =>
  specifier === 'vshu' || specifier.startsWith('vshu/')

/** Why a worker cannot import `vshu` at run time; `vshu plugin test` says the same. */
export function pluginWorkerVshuImportMessage(specifier: string): string {
  return `cannot import "${specifier}" at run time: it only provides types. Write \`import type { VshuWorkerApi } from 'vshu/worker'\` and use the \`vshu\` object passed to activate(vshu).`
}
