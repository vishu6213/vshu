/** JSX element factory for the guest `vshu` module. Elements are plain data until rendered. */

export const VSHU_ELEMENT = Symbol.for('vshu.declarative.element')
export const Fragment = Symbol.for('vshu.declarative.fragment')

export type VshuProps = Record<string, unknown>
/** Loosely typed on purpose: author-facing prop types live in the published `vshu` typings. */
export type VshuComponent = (props: VshuProps) => unknown
export type VshuElementType = string | typeof Fragment | VshuComponent

export type VshuElement = {
  readonly $$typeof: typeof VSHU_ELEMENT
  readonly type: VshuElementType
  readonly props: VshuProps
  readonly key: string | undefined
}

export function isVshuElement(value: unknown): value is VshuElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    value.$$typeof === VSHU_ELEMENT
  )
}

function createElement(type: VshuElementType, props: VshuProps, key: unknown): VshuElement {
  return Object.freeze({
    $$typeof: VSHU_ELEMENT,
    type,
    props,
    key: key === undefined || key === null ? undefined : String(key)
  })
}

/** Automatic runtime (`jsx`/`jsxs`/`jsxDEV`): children arrive inside `props`. */
export function jsx(type: VshuElementType, props: VshuProps | null, key?: unknown): VshuElement {
  const { key: propKey, ...rest } = props ?? {}
  return createElement(type, rest, key ?? propKey)
}

/** Classic runtime (`h`, `jsxFactory`): children arrive as trailing arguments. */
export function h(
  type: VshuElementType,
  props: VshuProps | null,
  ...children: unknown[]
): VshuElement {
  const { key, ...rest } = props ?? {}
  if (children.length > 0) {
    rest.children = children.length === 1 ? children[0] : children
  }
  return createElement(type, rest, key)
}
