import {
  renderPluginEventPayloadMembers,
  renderPluginHostMethodMembers
} from '../authoring/plugin-host-typings'

/** Markers around the generated region of resources/plugins/declarative/vshu.d.ts. */
export const VSHU_HOST_TYPINGS_BEGIN = '  // <generated: host methods, from plugin-host-api.ts>'
export const VSHU_HOST_TYPINGS_END = '  // </generated>'

/** The panel's host methods as `HostMethods`, from the same generator as `.vshu/types/vshu-host`. */
export function renderVshuHostTypings(): string {
  return [
    VSHU_HOST_TYPINGS_BEGIN,
    '  export type HostMethods = {',
    `${renderPluginHostMethodMembers('    ', { surface: 'panel', compact: true }).trimEnd()}`,
    '  }',
    '  /** Workspace and agent events `on(event)` delivers, with the read capability of their domain. */',
    '  export type PluginEvents = {',
    `${renderPluginEventPayloadMembers('    ').trimEnd()}`,
    '  }',
    VSHU_HOST_TYPINGS_END
  ].join('\n')
}

/** `file` with its generated region replaced; throws when the markers are missing. */
export function spliceVshuHostTypings(file: string): string {
  const begin = file.indexOf(VSHU_HOST_TYPINGS_BEGIN)
  const end = file.indexOf(VSHU_HOST_TYPINGS_END, begin)
  if (begin === -1 || end === -1) {
    throw new Error('vshu.d.ts lacks the generated host-method markers')
  }
  return (
    file.slice(0, begin) + renderVshuHostTypings() + file.slice(end + VSHU_HOST_TYPINGS_END.length)
  )
}
