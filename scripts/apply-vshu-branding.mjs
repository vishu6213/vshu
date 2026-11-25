// Regenerates every Vshu logo asset from resources/branding/vshu-logo-source.png
// (a chrome "V" on pure black): app icons (PNG, ICO, ICNS), app-icon picker
// variants, tray templates, mobile icons, in-app logo PNG/SVGs, docs logo/favicon.
//   tile         the artwork on its black background in a rounded tile
//   transparent  black keyed out (alpha = max(R,G,B), colour unpremultiplied)
//   V glyph      the V alone (ring, circle, sparkle dropped) over a soft metal fill,
//                legible at 16-32px; its luminance drives the one-colour glyphs
// Idempotent: unchanged files are not rewritten. Text branding: scripts/vshu-rebrand.mjs.
// Usage: node scripts/apply-vshu-branding.mjs (needs `sharp` resolvable from scripts/).

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const repoRoot = path.resolve(import.meta.dirname, '..')
const SOURCE = 'resources/branding/vshu-logo-source.png'
const PAD = 400 // black margin so a loose crop never leaves the image
// The top of the mark is the orbit circle's arc; dropping it frames the V for tiny glyphs.
const V_FOCUS_TOP = 0.16
// Outline of the V, traced on the 1254px master.
const V_PATH = 'M182 348 H500 L632 712 L776 348 H1062 L632 990 Z'
const METAL = `<defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4e4e7"/>
<stop offset="1" stop-color="#71717a"/></linearGradient></defs>`
const MAC_RADIUS = 0.2237
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }
const clamp01 = (v) => Math.min(1, Math.max(0, v))

function write(rel, data) {
  const file = path.join(repoRoot, rel)
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (!fs.existsSync(path.dirname(file))) {
    return
  }
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) {
    console.log(`unchanged ${rel}`)
    return
  }
  fs.writeFileSync(file, bytes)
  console.log(`wrote     ${rel}`)
}

const png = (img, palette = false) =>
  img
    .png(palette ? { palette: true, colours: 128, effort: 10 } : { compressionLevel: 9 })
    .toBuffer()
const raw = (data, w, h, channels) => sharp(data, { raw: { width: w, height: h, channels } })
const svg = (w, h, body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)
const roundRect = (size, radius, attrs = 'fill="#fff"') =>
  svg(size, size, `<rect width="${size}" height="${size}" rx="${size * radius}" ${attrs}/>`)
const blank = (s) =>
  sharp({ create: { width: s, height: s, channels: 4, background: TRANSPARENT } })
const clip = async (img, mask) => {
  const opaque = sharp(await png(img)).ensureAlpha()
  return png(opaque.composite([{ input: mask, blend: 'dest-in' }]))
}
const masked = (img, size, radius) => clip(img, roundRect(size, radius))

async function loadSource() {
  const file = path.join(repoRoot, SOURCE)
  const { info: trim } = await sharp(file)
    .removeAlpha()
    .trim({ threshold: 24 })
    .toBuffer({ resolveWithObject: true })
  const { data, info } = await sharp(file)
    .removeAlpha()
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: '#000000' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { trimOffsetLeft: dx, trimOffsetTop: dy, width, height } = trim
  const box = { left: PAD + Math.abs(dx), top: PAD + Math.abs(dy), width, height }
  // Silver keyed off black: alpha from the brightest channel, colour divided back out.
  const silver = Buffer.alloc(info.width * info.height * 4)
  for (let p = 0; p < info.width * info.height; p++) {
    const a = clamp01((Math.max(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]) - 8) / 88)
    for (let c = 0; c < 3; c++) {
      silver[p * 4 + c] = a > 0 ? Math.min(255, Math.round(data[p * 3 + c] / a)) : 0
    }
    silver[p * 4 + 3] = Math.round(a * 255)
  }
  return { data, w: info.width, h: info.height, box, silver, scale: (info.width - 2 * PAD) / 1254 }
}

/** Square crop around the mark (optionally V-focused) where the mark spans `fill` of the side. */
function region(src, fill, focus = false) {
  const cut = focus ? Math.round(src.box.height * V_FOCUS_TOP) : 0
  const box = { ...src.box, top: src.box.top + cut, height: src.box.height - cut }
  const side = Math.round(Math.max(box.width, box.height) / fill)
  const left = Math.round(box.left + box.width / 2 - side / 2)
  return { left, top: Math.round(box.top + box.height / 2 - side / 2), width: side, height: side }
}

/** The artwork on black, cropped so the mark fills `fill`; rounded tile with a faint edge, or square. */
async function tile(src, size, { fill = 0.83, radius = 0.16, round = true } = {}) {
  const img = raw(src.data, src.w, src.h, 3).extract(region(src, fill)).resize(size, size)
  if (!round) {
    return png(img)
  }
  const edge = `fill="none" stroke="#fff" stroke-opacity="0.14" stroke-width="${size / 80}"`
  return png(
    sharp(await masked(img, size, radius)).composite([{ input: roundRect(size, radius, edge) }])
  )
}

/** Transparent logo as a square PNG where the mark spans `fill` of the side. */
async function logo(src, size, { fill = 0.96, invert = false, palette = false } = {}) {
  const img = raw(src.silver, src.w, src.h, 4).extract(region(src, fill)).resize(size, size)
  return png(invert ? img.negate({ alpha: false }) : img, palette)
}

/** Large opaque V glyph: the artwork inside the traced V, lightened over a metal fill. */
async function vGlyph(src) {
  const r = region(src, 0.92, true)
  const move = `transform="translate(${PAD - r.left} ${PAD - r.top}) scale(${src.scale})"`
  const shape = (paint) => svg(r.width, r.height, `${METAL}<path ${move} d="${V_PATH}" ${paint}/>`)
  const inside = await clip(raw(src.data, src.w, src.h, 3).extract(r), shape('fill="#fff"'))
  const black = { create: { width: r.width, height: r.height, channels: 4, background: '#000000' } }
  const metal = { input: shape('fill="url(#m)" fill-opacity="0.6"') }
  return png(sharp(black).composite([metal, { input: inside, blend: 'lighten' }]))
}

const smallTile = (glyph, size, round = true) =>
  round
    ? masked(sharp(glyph).resize(size, size), size, 0.14)
    : png(sharp(glyph).resize(size, size).removeAlpha())

/** One-colour glyph: alpha from the V glyph's luminance, trimmed, padded to `fill`, fitted into w x h. */
async function monoGlyph(glyph, w, h, rgb, fill = 1) {
  const grey = await sharp(glyph).resize(256, 256).greyscale().raw().toBuffer()
  const rgba = Buffer.alloc(256 * 256 * 4, rgb)
  for (let p = 0; p < 256 * 256; p++) {
    rgba[p * 4 + 3] = Math.round(clamp01((grey[p] - 10) / 90) * 255)
  }
  const { data, info } = await raw(rgba, 256, 256, 4)
    .trim({ background: TRANSPARENT })
    .png()
    .toBuffer({ resolveWithObject: true })
  const pad = Math.round((Math.max(info.width, info.height) * (1 / fill - 1)) / 2)
  const padded = await png(
    sharp(data).extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
  )
  return png(sharp(padded).resize(w, h, { fit: 'contain', background: TRANSPARENT }))
}

/** Places a square tile on a transparent canvas, optionally with a soft macOS-style shadow. */
async function framed(tileBuf, size, inner, shadow) {
  const off = Math.round((size - inner) / 2)
  const layers = []
  if (shadow) {
    const rect = `<rect x="${off}" y="${off + size * 0.012}" width="${inner}" height="${inner}" rx="${inner * MAC_RADIUS}" fill-opacity="0.45"/>`
    layers.push({ input: await png(sharp(svg(size, size, rect)).blur(size * 0.014)) })
  }
  layers.push({ input: await png(sharp(tileBuf).resize(inner, inner)), left: off, top: off })
  return png(blank(size).composite(layers))
}

const winIcon = async (src, size) =>
  framed(await tile(src, size), size, Math.round(size * 0.96), false)
const macIcon = async (src, size) => {
  const inner = Math.round((size * 824) / 1024)
  return framed(await tile(src, inner, { radius: MAC_RADIUS }), size, inner, true)
}

const fillRect = (paint) => `<rect width="100%" height="100%" ${paint}/>`
const stop = (offset, color, opacity = 1) =>
  `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`
const diagonal = (a, b, c) =>
  `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stop(0, a)}${stop(0.55, b)}${stop(1, c)}</linearGradient>`
const glow = (id, at, color, opacity) =>
  `<radialGradient id="${id}" ${at}>${stop(0, color, opacity)}${stop(1, color, 0)}</radialGradient>`
const BLUE_BG = diagonal('#2f6bff', '#1a4ad0', '#0a2a8c')
const WATERCOLOR_BG = [
  diagonal('#2a5d8f', '#2b3f7d', '#3a2b6e'),
  glow('t', 'cx=".22" cy=".3" r=".55"', '#3fb0c4', 0.55),
  glow('v', 'cx=".82" cy=".8" r=".55"', '#8a64d6', 0.55),
  glow('l', 'cx=".5" cy=".04" r=".4"', '#eaf6ff', 0.4),
  '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves="5" seed="7"/>',
  '<feColorMatrix values="0 0 0 0 .85 0 0 0 0 .93 0 0 0 0 1 0 0 0 .9 -.3"/></filter>'
].join('')
const WATERCOLOR_LAYERS =
  ['t', 'v', 'l'].map((id) => fillRect(`fill="url(#${id})"`)).join('') +
  fillRect('filter="url(#n)" opacity=".3"')

/** The transparent logo, with a soft drop shadow, over a coloured tile (app-icon picker variants). */
async function brandTile(src, size, defs, layers = '') {
  const bg = svg(size, size, `<defs>${defs}</defs>${fillRect('fill="url(#g)"')}${layers}`)
  const mark = await logo(src, size, { fill: 0.8 })
  const shade = sharp(mark).linear([0, 0, 0, 0.6], [0, 0, 0, 0])
  const shadow = await png(shade.blur(size * 0.012))
  const offset = Math.round(size * 0.01)
  return masked(
    sharp(bg).composite([{ input: shadow, top: offset, left: 0 }, { input: mark }]),
    size,
    MAC_RADIUS
  )
}

/** ICO with PNG-compressed frames (Vista+). */
function buildIco(frames) {
  const header = Buffer.alloc(6 + frames.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach(([size, data], i) => {
    const e = 6 + i * 16
    header.writeUInt8(size % 256, e)
    header.writeUInt8(size % 256, e + 1)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...frames.map(([, data]) => data)])
}

const icnsChunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.write(type, 0, 'latin1')
  head.writeUInt32BE(data.length + 8, 4)
  return Buffer.concat([head, data])
}

const svgWithPng = (data, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
  `<image width="${size}" height="${size}" href="data:image/png;base64,${data.toString('base64')}"/></svg>\n`

async function main() {
  const src = await loadSource()
  const glyph = await vGlyph(src)

  // In-app logo: transparent, for dark UI (light themes invert it with CSS).
  const logoSvg = svgWithPng(await logo(src, 256, { palette: true }), 256)
  write('resources/logo.svg', logoSvg)
  write('resources/icon-source/icon.icon/Assets/logo.svg', logoSvg)
  write('src/renderer/src/assets/vshu-logo.svg', logoSvg)
  write('docs/site/public/docs/logo.svg', logoSvg)
  write('src/renderer/src/assets/vshu-logo.png', await logo(src, 512, { palette: true }))
  write('mobile/assets/vshu-logo.png', await logo(src, 192, { palette: true }))
  write(
    'mobile/assets/vshu-logo-on-light.png',
    await logo(src, 192, { invert: true, palette: true })
  )

  // Desktop app icons; 32px and below use the V glyph so the mark stays legible.
  const icon512 = await winIcon(src, 512)
  write('resources/icon.png', icon512)
  write('resources/icon-dev.png', icon512)
  write('resources/build/icon.png', icon512)
  write('resources/icon-dev-mac.png', await macIcon(src, 512))
  const frames = []
  for (const size of [256, 128, 64, 48, 32, 24, 16]) {
    frames.push([size, size <= 32 ? await smallTile(glyph, size) : await winIcon(src, size)])
  }
  write('resources/build/icon.ico', buildIco(frames))
  write('docs/site/public/docs/favicon.ico', buildIco(frames))

  // macOS list views read the small slots directly, so those skip the Apple safe-area inset.
  const slots = { icp4: 16, icp5: 32, ic11: 32, ic12: 64, ic07: 128, ic08: 256, ic13: 256 }
  Object.assign(slots, { ic09: 512, ic14: 512, ic10: 1024 })
  const chunks = []
  for (const [type, size] of Object.entries(slots)) {
    if (size <= 32) {
      chunks.push(icnsChunk(type, await smallTile(glyph, size)))
    } else {
      chunks.push(
        icnsChunk(type, size === 64 ? await winIcon(src, size) : await macIcon(src, size))
      )
    }
  }
  write('resources/build/icon.icns', icnsChunk('icns', Buffer.concat(chunks)))

  // App-icon picker variants: the same mark over blue and watercolour tiles.
  const blue = await brandTile(src, 824, BLUE_BG)
  write('resources/app-icons/vshu-blue.png', await framed(blue, 1024, 824, true))
  const watercolor = await brandTile(src, 1024, WATERCOLOR_BG, WATERCOLOR_LAYERS)
  write('resources/app-icons/vshu-watercolor.png', await framed(watercolor, 1024, 983, false))
  write('resources/app-icons/vshu-watercolor-mac.png', await framed(watercolor, 1024, 824, true))

  // macOS menu-bar template: black glyph on transparent.
  write('resources/tray/vshu-menu-barTemplate.png', await monoGlyph(glyph, 22, 14, 0))
  write('resources/tray/vshu-menu-barTemplate@2x.png', await monoGlyph(glyph, 44, 28, 0))

  // Mobile: opaque iOS icon, Android adaptive foreground (safe zone), splash, notification, favicon.
  write('mobile/assets/icon.png', await tile(src, 1024, { fill: 0.8, round: false }))
  write('mobile/assets/adaptive-icon.png', await logo(src, 1024, { fill: 0.6 }))
  const splash = sharp(await logo(src, 255, { fill: 0.98 }))
  write(
    'mobile/assets/splash-icon.png',
    await png(splash.resize(400, 255, { fit: 'contain', background: TRANSPARENT }))
  )
  write('mobile/assets/notification-icon.png', await monoGlyph(glyph, 56, 56, 255, 0.86))
  write('mobile/assets/favicon.png', await smallTile(glyph, 48, false))
}

main().catch((err) => {
  console.error('Error generating Vshu icons:', err)
  process.exit(1)
})
