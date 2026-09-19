// Modo demo: a partida vive neste navegador (localStorage) e sincronízase entre lapelas.
// Cada lapela é unha persoa distinta, así que se pode probar a mecánica sen servidor.
import { local, tab, uuid } from './store.js'
import * as C from './core.js'

const KEY = 'cx_demo_v2'
const LOCK = C.LOCK_MINUTES * 60000

export function create() {
  let session = tab.get('cx_session')
  if (!session) { session = uuid(); tab.set('cx_session', session) }
  let bus = null
  try { bus = new BroadcastChannel(KEY) } catch {}
  let notify = () => {}
  if (bus) bus.onmessage = () => notify()

  const read = () => { try { return JSON.parse(local.get(KEY)) || { games: [], tiles: [] } } catch { return { games: [], tiles: [] } } }
  const write = db => { local.set(KEY, JSON.stringify(db)); bus?.postMessage(1); notify() }
  const iso = ms => new Date(ms).toISOString()
  const pub = ({ session: _s, draft: _d, pixels: _p, ...t }) => t
  const fail = code => ({ ok: false, code })

  function sweep(db, gameId) {
    for (const t of db.tiles) if (t.game_id === gameId && t.status === 'editing' && Date.parse(t.lock_expires_at) < Date.now())
      Object.assign(t, { status: 'open', editor_name: null, lock_expires_at: null, session: null, draft: null })
  }
  const ownKeys = (db, gameId, who) => new Set(db.tiles
    .filter(t => t.game_id === gameId && t.status === 'done' && t.session === who).map(t => `${t.row_no}_${t.col_no}`))
  function doReveal(db, game) {
    for (const t of db.tiles) if (t.game_id === game.id) {
      if (t.status === 'done') t.art = t.pixels
      else if (t.status === 'editing') Object.assign(t, { status: 'open', editor_name: null, lock_expires_at: null })
    }
    Object.assign(game, { status: 'revealed', revealed_at: iso(Date.now()) })
  }

  function claimAs(db, gameId, r, c, who, name) {
    const game = db.games.find(g => g.id === gameId)
    if (!game || game.status !== 'playing') return fail('closed')
    sweep(db, gameId)
    const tiles = db.tiles.filter(t => t.game_id === gameId)
    if (tiles.some(t => t.status === 'editing' && t.session === who)) return fail('busy')
    const t = C.tileAt(tiles, r, c)
    if (!t) return fail('invalid')
    if (t.status !== 'open') return fail('taken')
    const st = C.cellState(tiles, t)
    if (st === 'future') return fail('ring')
    if (st === 'blocked') return fail('neighbour')
    if (game.avoid_own && C.ownRuleApplies(tiles, t, ownKeys(db, gameId, who))) return fail('own')
    Object.assign(t, { status: 'editing', editor_name: name || 'Anónimo', session: who, draft: null, lock_expires_at: iso(Date.now() + LOCK) })
    return { ok: true }
  }
  function finishAs(db, gameId, r, c, who, pixels) {
    if (!C.isValid(pixels) || C.countPainted(C.decode(pixels)) < C.MIN_PAINTED) return fail('invalid')
    const t = mine(db, gameId, r, c, who)
    if (!t) return fail('not_yours')
    Object.assign(t, { status: 'done', pixels, draft: null, frame: C.frameOf(pixels), lock_expires_at: null, finished_at: iso(Date.now()) })
    if (!db.tiles.some(o => o.game_id === gameId && o.status !== 'done')) doReveal(db, db.games.find(g => g.id === gameId))
    return { ok: true }
  }
  const mine = (db, g, r, c, who) => db.tiles.find(t => t.game_id === g && t.row_no === r && t.col_no === c && t.status === 'editing' && t.session === who)

  return {
    demo: true,
    async createGame({ title, name, size, goal, avoidOwn }) {
      const db = read(), id = uuid(), m = (size - 1) / 2
      let code; do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[(Math.random() * 23) | 0]).join('') } while (db.games.some(g => g.code === code))
      db.games.push({ id, code, title: title || 'Cadáver exquisito', creator_name: name, board_size: size, goal: Math.min(goal || size * size, size * size), avoid_own: !!avoidOwn, status: 'playing', revealed_at: null, creator: session })
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        db.tiles.push({ id: uuid(), game_id: id, row_no: r, col_no: c, ring_no: C.ringOf(size, r, c), status: 'open', editor_name: null, lock_expires_at: null, frame: null, art: null })
      write(db)
      return { ok: true, gameCode: code }
    },
    async getGame(code) { const g = read().games.find(g => g.code === code); if (!g) return null; const { creator: _c, ...rest } = g; return rest },
    async loadTiles(gameId) { return read().tiles.filter(t => t.game_id === gameId).map(pub) },
    async resume(gameId) {
      const db = read(), ts = db.tiles.filter(t => t.game_id === gameId && t.session === session)
      const e = ts.find(t => C.isLive(t))
      return {
        creator: db.games.find(g => g.id === gameId)?.creator === session,
        editing: e ? { row: e.row_no, col: e.col_no, draft: e.draft } : null,
        mine: ts.filter(t => t.status === 'done').map(t => ({ row: t.row_no, col: t.col_no, pixels: t.pixels }))
      }
    },
    async claim(g, r, c, name) { const db = read(), res = claimAs(db, g, r, c, session, name); if (res.ok) write(db); return res },
    async saveDraft(g, r, c, pixels) {
      const db = read(), t = mine(db, g, r, c, session)
      if (!t) return fail('not_yours')
      t.draft = pixels; t.lock_expires_at = iso(Date.now() + LOCK)
      local.set(KEY, JSON.stringify(db))       // sen aviso: o borrador non cambia nada visible
      return { ok: true }
    },
    async finish(g, r, c, pixels) { const db = read(), res = finishAs(db, g, r, c, session, pixels); if (res.ok) write(db); return res },
    async release(g, r, c) {
      const db = read(), game = db.games.find(x => x.id === g)
      const t = db.tiles.find(t => t.game_id === g && t.row_no === r && t.col_no === c && t.status === 'editing' && (t.session === session || game?.creator === session))
      if (!t) return fail('not_yours')
      Object.assign(t, { status: 'open', editor_name: null, lock_expires_at: null, session: null, draft: null })
      write(db); return { ok: true }
    },
    async reveal(g) {
      const db = read(), game = db.games.find(x => x.id === g)
      if (game?.creator !== session) return fail('not_creator')
      if (!db.tiles.some(t => t.game_id === g && t.status === 'done')) return fail('invalid')
      doReveal(db, game); write(db); return { ok: true }
    },
    unsubscribe() { notify = () => {} },
    subscribe(gameId, onTile, onGame) {
      notify = async () => { onTile(null); const g = read().games.find(g => g.id === gameId); if (g) { const { creator: _c, ...rest } = g; onGame(rest) } }
    },

    // Só no modo demo: unha persoa inventada colle unha casilla libre e continúa as pistas.
    async botMove(gameId) {
      const db = read(); sweep(db, gameId)
      const tiles = db.tiles.filter(t => t.game_id === gameId)
      const options = tiles.filter(t => C.cellState(tiles, t) === 'open')
      if (!options.length) return fail('taken')
      const t = options[(Math.random() * options.length) | 0], who = 'bot-' + uuid()
      const names = ['Maruxa', 'Breogán', 'Uxía', 'Anxo', 'Sabela', 'Roi', 'Noa', 'Xurxo']
      if (!claimAs(db, gameId, t.row_no, t.col_no, who, names[(Math.random() * names.length) | 0]).ok) return fail('taken')
      finishAs(db, gameId, t.row_no, t.col_no, who, doodle(tiles, t.row_no, t.col_no))
      write(db); return { ok: true }
    }
  }
}

// Garabato automático: prolonga cara a dentro cada trazo que asoma das veciñas e engade un par de trazos propios.
function doodle(tiles, row, col) {
  const px = C.blank(), halo = C.buildHalo(tiles, row, col), rnd = n => (Math.random() * n) | 0
  if (Math.random() < .5) px.fill(1 + rnd(7))
  const walk = (x, y, tx, ty, color, size) => {
    for (let i = 0; i < 60 && (Math.abs(x - tx) > 1 || Math.abs(y - ty) > 1); i++) {
      const nx = Math.max(0, Math.min(39, x + Math.sign(tx - x) + rnd(3) - 1)), ny = Math.max(0, Math.min(39, y + Math.sign(ty - y) + rnd(3) - 1))
      C.line(x, y, nx, ny, (a, b) => C.stamp(px, a, b, size, color)); x = nx; y = ny
    }
  }
  const cx = 12 + rnd(16), cy = 12 + rnd(16)
  for (let i = 0; i < C.TILE; i += 3) for (const [vx, vy, x, y] of [[i + 4, 3, i, 0], [i + 4, 44, i, 39], [3, i + 4, 0, i], [44, i + 4, 39, i]]) {
    const v = halo.px[vy * C.VIEW + vx]
    if (v !== C.EMPTY && Math.random() < .8) walk(x, y, cx, cy, v, 2)
  }
  for (let i = 0; i < 3; i++) {
    const color = rnd(32), a = rnd(40), b = rnd(40)
    Math.random() < .5 ? walk(a, 0, b, 39, color, 2 + rnd(3)) : walk(0, a, 39, b, color, 2 + rnd(3))
  }
  C.stamp(px, cx, cy, 6, rnd(32))
  return C.encode(px)
}
