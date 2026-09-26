// Lóxica pura do xogo: formato de píxeles, aneis, pistas e ferramentas de debuxo.
// Non toca o DOM nin a rede, así que a usan por igual a interface e o modo demo.

// Xeometría e paleta da partida actual. Son "let" exportados: configure() cámbiaos e todos os módulos ven o novo valor.
export let TILE = 40          // lado dunha peza, en píxeles (40 sinxelo, 80 fino)
export let EDGE = 4           // franxa exterior que ven os veciños: 4 px en sinxelo, 6 en fino
export let VIEW = TILE + EDGE * 2
export let MIN_PAINTED = 40
export let NCOLORS = 32
export let COLORS = []
export let BRUSHES = [1, 2, 4, 6]
export const LOCK_MINUTES = 5
export const EMPTY = 255
export const SIZES = [40, 80]
export const PALETTES = [32, 64]

// 32 cores: 8 familias en columnas (neutros, azul, verde, amarelo, laranxa, vermello, violeta, terra)
// e 4 tons en filas, de claro a escuro. O negro é negro puro e vai cos grises, lonxe do azul escuro.
export const BASE32 = [
  '#FFFFFF','#A6D7F4','#C5E384','#FFF1B0','#FFC89A','#F7A8A8','#F3B6E0','#F0D2B0',
  '#C9D1DC','#4FA3E8','#5AAE68','#FFD93D','#F49B61','#ED5A5A','#C86DCD','#D6A06E',
  '#6B7482','#0F5EA8','#2E7A4A','#E0A100','#D9621F','#B82A3A','#833D95','#9A6A45',
  '#111111','#1B3F7A','#1F4A35','#8F6500','#8A3B12','#6E1A2B','#4B2363','#4E3526'
]
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const toHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
// 64 cores: as mesmas 8 familias con 8 tons, interpolando entre os 4 de base (e un extra máis claro e máis escuro).
export const BASE64 = (() => {
  const out = []
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const anchors = [0, 1, 2, 3].map(k => hex(BASE32[k * 8 + c]))
    const pos = r / 7 * 3             // filas 0 e 7 = tons 0 e 3 de base; o resto, intermedios
    const i = Math.max(0, Math.min(2, Math.floor(pos))), f = pos - i
    out.push(toHex(anchors[i].map((v, k) => v + (anchors[i + 1][k] - v) * f)))
  }
  return out
})()

export function configure(size = 40, colors = 32) {
  TILE = SIZES.includes(size) ? size : 40
  EDGE = TILE === 80 ? 6 : 4
  VIEW = TILE + EDGE * 2
  MIN_PAINTED = TILE
  NCOLORS = PALETTES.includes(colors) ? colors : 32
  COLORS = NCOLORS === 64 ? BASE64 : BASE32
  BRUSHES = TILE === 80 ? [1, 2, 3, 4, 6, 8] : [1, 2, 4, 6]
}
configure()
// Unha peza gárdase como TILE*TILE caracteres: '.' = baleiro, e un carácter por cor.
export const CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-'
const VALID32 = /^[0-9a-v.]+$/, VALID64 = /^[0-9a-zA-Z_.-]+$/

export const blank = () => new Uint8Array(TILE * TILE).fill(EMPTY)
export const isValid = s => typeof s === 'string' && s.length === TILE * TILE && (NCOLORS === 64 ? VALID64 : VALID32).test(s)
export function encode(px) {
  let s = ''
  for (let i = 0; i < px.length; i++) s += px[i] === EMPTY ? '.' : CHARS[px[i]]
  return s
}
export function decode(str) {
  const px = blank()
  if (!isValid(str)) return px
  for (let i = 0; i < px.length; i++) {
    const c = str[i]
    if (c !== '.') px[i] = CHARS.indexOf(c)
  }
  return px
}
export const countPainted = px => px.reduce((n, v) => n + (v !== EMPTY ? 1 : 0), 0)

// O marco é o único que se fai público dunha peza rematada: o interior vai en branco.
export function frameOf(str) {
  let out = ''
  for (let y = 0; y < TILE; y++) {
    const row = str.substr(y * TILE, TILE)
    out += (y < EDGE || y >= TILE - EDGE)
      ? row
      : row.slice(0, EDGE) + '.'.repeat(TILE - EDGE * 2) + row.slice(TILE - EDGE)
  }
  return out
}

export const SIDES = ['top', 'right', 'bottom', 'left']
const SIDE_DELTA = { top: [-1, 0], right: [0, 1], bottom: [1, 0], left: [0, -1] }
export function sideHasInk(px, side) {
  for (let i = 0; i < TILE; i++) for (let d = 0; d < EDGE; d++) {
    const [x, y] = side === 'top' ? [i, d] : side === 'bottom' ? [i, TILE - 1 - d]
      : side === 'left' ? [d, i] : [TILE - 1 - d, i]
    if (px[y * TILE + x] !== EMPTY) return true
  }
  return false
}

// ── Taboleiro ─────────────────────────────────────────────
export const ringOf = (size, r, c) => { const m = (size - 1) / 2; return Math.max(Math.abs(r - m), Math.abs(c - m)) }
export const tileName = (r, c) => 'ABCDEFGHI'[c] + (r + 1)
export const tileAt = (tiles, r, c) => tiles.find(t => t.row_no === r && t.col_no === c)
export const isLive = (t, now = Date.now()) => t.status === 'editing' && Date.parse(t.lock_expires_at) > now
export const doneCount = tiles => tiles.filter(t => t.status === 'done').length

export function activeRing(tiles) {
  let min = null
  for (const t of tiles) if (t.status !== 'done' && (min === null || t.ring_no < min)) min = t.ring_no
  return min
}
const touches = (a, b) => Math.abs(a.row_no - b.row_no) <= 1 && Math.abs(a.col_no - b.col_no) <= 1 && a !== b

// Salto de anel: mentres no primeiro anel incompleto quede algunha casilla que se poida coller,
// xógase aí. Se todas as que faltan están ocupadas ou bloqueadas, ábrese o anel seguinte (só un),
// e nel só as casillas que xa tocan por un lado unha peza rematada, para que sempre haxa pista.
export function ringOpen(tiles, t, now = Date.now()) {
  const ring = activeRing(tiles)
  if (t.ring_no === ring) return true
  if (t.ring_no !== ring + 1) return false
  const live = tiles.filter(o => isLive(o, now))
  const freeInRing = tiles.some(o => o.ring_no === ring && o.status !== 'done' && !isLive(o, now) && !live.some(e => touches(e, o)))
  if (freeInRing) return false
  return SIDES.some(s => { const n = tileAt(tiles, t.row_no + SIDE_DELTA[s][0], t.col_no + SIDE_DELTA[s][1]); return n && n.status === 'done' })
}
// Quen está debuxando arredor dunha casilla bloqueada.
export const blockers = (tiles, t, now = Date.now()) => tiles.filter(o => isLive(o, now) && touches(o, t)).map(o => o.editor_name || '?')

// Estado dunha casilla para quen mira: done | live | open | blocked | future
export function cellState(tiles, t, now = Date.now()) {
  if (t.status === 'done') return 'done'
  if (isLive(t, now)) return 'live'
  if (!ringOpen(tiles, t, now)) return 'future'
  return tiles.some(o => isLive(o, now) && touches(o, t)) ? 'blocked' : 'open'
}

// ownKeys: conxunto "fila_columna" das pezas que xa rematou esta persoa.
export function touchesOwn(t, ownKeys) {
  return SIDES.some(s => ownKeys.has(`${t.row_no + SIDE_DELTA[s][0]}_${t.col_no + SIDE_DELTA[s][1]}`))
}
// A regra "non pegado ao teu" relaxase se non queda ningunha outra casilla no anel.
export function ownRuleApplies(tiles, t, ownKeys) {
  if (!touchesOwn(t, ownKeys)) return false
  return tiles.some(o => o.status !== 'done' && o !== t && ringOpen(tiles, o) && !touchesOwn(o, ownKeys))
}

// Halo de 48×48: ao redor da peza propia, os 4 px que asoman de cada veciña rematada.
export function buildHalo(tiles, row, col) {
  const px = new Uint8Array(VIEW * VIEW).fill(EMPTY)
  const present = new Uint8Array(VIEW * VIEW)   // 1 = hai veciña rematada nesa zona
  const sides = {}
  const cache = {}
  const frame = (dr, dc) => {
    const k = dr + ',' + dc
    if (!(k in cache)) {
      const n = tileAt(tiles, row + dr, col + dc)
      cache[k] = n && n.status === 'done' && isValid(n.frame) ? decode(n.frame) : null
    }
    return cache[k]
  }
  for (let vy = 0; vy < VIEW; vy++) for (let vx = 0; vx < VIEW; vx++) {
    const dr = vy < EDGE ? -1 : vy >= VIEW - EDGE ? 1 : 0
    const dc = vx < EDGE ? -1 : vx >= VIEW - EDGE ? 1 : 0
    if (!dr && !dc) continue
    const f = frame(dr, dc)
    if (!f) continue
    const x = vx - EDGE - dc * TILE, y = vy - EDGE - dr * TILE
    px[vy * VIEW + vx] = f[y * TILE + x]
    present[vy * VIEW + vx] = 1
  }
  for (const s of SIDES) sides[s] = !!frame(...SIDE_DELTA[s])
  return { px, present, sides }
}

// Lados onde aínda ha de debuxar alguén (hai casilla e non está rematada).
export function pendingSides(tiles, row, col) {
  return SIDES.filter(s => {
    const n = tileAt(tiles, row + SIDE_DELTA[s][0], col + SIDE_DELTA[s][1])
    return n && n.status !== 'done'
  })
}

// ── Ferramentas ───────────────────────────────────────────
export function stamp(px, x, y, size, val) {
  const o = Math.floor(size / 2)
  for (let yy = y - o; yy < y - o + size; yy++) for (let xx = x - o; xx < x - o + size; xx++)
    if (xx >= 0 && yy >= 0 && xx < TILE && yy < TILE) px[yy * TILE + xx] = val
}
export function line(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    fn(x0, y0)
    if (x0 === x1 && y0 === y1) return
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}
export function flood(px, x, y, val) {
  const old = px[y * TILE + x]
  if (old === val) return
  const stack = [y * TILE + x]
  while (stack.length) {
    const i = stack.pop()
    if (px[i] !== old) continue
    px[i] = val
    const cx = i % TILE
    if (cx > 0) stack.push(i - 1)
    if (cx < TILE - 1) stack.push(i + 1)
    if (i >= TILE) stack.push(i - TILE)
    if (i < TILE * (TILE - 1)) stack.push(i + TILE)
  }
}
