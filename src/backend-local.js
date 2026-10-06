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
    if (game.week && tiles.some(t => t.status === 'done' && t.session === who)) return fail('weekly_once')
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
    async createGame({ title, name, size, goal, avoidOwn, tileSize, colors }) {
      const db = read(), id = uuid(), m = (size - 1) / 2
      let code; do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[(Math.random() * 23) | 0]).join('') } while (db.games.some(g => g.code === code))
      db.games.push({ id, code, title: title || 'Cadáver exquisito', creator_name: name, board_size: size, goal: Math.min(goal || size * size, size * size), avoid_own: !!avoidOwn, tile_size: tileSize || 40, colors: colors || 32, status: 'playing', revealed_at: null, creator: session })
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
    async recent(codes) {
      const db = read()
      return db.games.filter(g => codes.includes(g.code)).map(g => {
        const ts = db.tiles.filter(t => t.game_id === g.id)
        return { code: g.code, size: g.board_size, goal: g.goal, status: g.status,
          done: ts.filter(t => t.status === 'done').length, creator: g.creator === session,
          mine: ts.some(t => t.session === session && (t.status === 'done' || t.draft)) }
      })
    },
    async deleteGame(code) {
      const db = read(), g = db.games.find(x => x.code === code)
      if (!g) return { ok: true }
      if (g.creator !== session) return fail('not_creator')
      if (db.tiles.some(t => t.game_id === g.id && t.status === 'done')) return fail('not_empty')
      db.games = db.games.filter(x => x.id !== g.id); db.tiles = db.tiles.filter(t => t.game_id !== g.id)
      write(db); return { ok: true }
    },
    // Reto da semana en modo demo: mesmas regras, pero neste navegador.
    async createInktober({ name, size, tileSize, prompt }) {
      const res = await this.createGame({ title: '', name, size, goal: size * size, avoidOwn: true, tileSize, colors: 2 })
      if (!res.ok) return res
      const db = read(); const g = db.games.find(x => x.code === res.gameCode); g.prompt = prompt; write(db)
      return res
    },
    async inktoberGallery(year) {
      const db = read()
      return db.games.filter(g => (g.prompt || '').startsWith(`ink-${year}-`))
        .sort((a, b) => a.prompt < b.prompt ? 1 : -1)
        .map(g => ({ code: g.code, prompt: g.prompt, size: g.board_size, tile: g.tile_size, status: g.status,
          done: db.tiles.filter(t => t.game_id === g.id && t.status === 'done').length,
          live: db.tiles.filter(t => t.game_id === g.id && C.isLive(t)).length }))
    },
    async weekly() {
      const db = read(), now = new Date()
      const ws = new Date(now); ws.setHours(0, 0, 0, 0); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7))
      const wk = ws.toISOString().slice(0, 10)
      let g = db.games.find(x => x.week === wk)
      if (!g) {
        const sizes = [3, 5, 7, 9]
        const past = db.games.filter(x => x.week && x.week < wk).sort((a, b) => a.week < b.week ? 1 : -1)
        let n = 5
        if (past[0]) {
          const prev = past[0], ts = db.tiles.filter(t => t.game_id === prev.id)
          const done = ts.filter(t => t.status === 'done')
          let i = Math.max(0, sizes.indexOf(prev.board_size))
          if (done.length >= prev.board_size ** 2) {
            const last = Math.max(...done.map(t => Date.parse(t.finished_at || 0)))
            if (last < Date.parse(prev.week) + 5 * 864e5) i = Math.min(i + 1, sizes.length - 1)
          } else i = Math.max(i - 1, 0)
          n = sizes[i]
          if (prev.status === 'playing') doReveal(db, prev)
        }
        const id = uuid()
        let code; do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[(Math.random() * 23) | 0]).join('') } while (db.games.some(x => x.code === code))
        g = { id, code, title: '', creator_name: null, board_size: n, goal: n * n, avoid_own: true, tile_size: 40, colors: 32, status: 'playing', revealed_at: null, creator: null, week: wk, week_start: wk }
        db.games.push(g)
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
          db.tiles.push({ id: uuid(), game_id: id, row_no: r, col_no: c, ring_no: C.ringOf(n, r, c), status: 'open', editor_name: null, lock_expires_at: null, frame: null, art: null })
        write(db)
      }
      const ts = db.tiles.filter(t => t.game_id === g.id)
      const info = x => ({ code: x.code, week: x.week, week_start: x.week_start, size: x.board_size, status: x.status,
        done: db.tiles.filter(t => t.game_id === x.id && t.status === 'done').length })
      return { ...info(g), mine: ts.some(t => t.session === session && (t.status === 'done' || t.draft)),
        played: ts.some(t => t.session === session && t.status === 'done'),
        past: db.games.filter(x => x.week && x.week < wk).sort((a, b) => a.week < b.week ? 1 : -1).slice(0, 8).map(info) }
    },
    async stats() { const db = read(); return { games: db.games.filter(g => g.status === 'playing').length, drawing: db.tiles.filter(t => C.isLive(t)).length } },
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
  if (Math.random() < .5) px.fill(C.NCOLORS === 2 ? 1 : 1 + rnd(7))
  const walk = (x, y, tx, ty, color, size) => {
    for (let i = 0; i < C.TILE * 1.5 && (Math.abs(x - tx) > 1 || Math.abs(y - ty) > 1); i++) {
      const nx = Math.max(0, Math.min(C.TILE - 1, x + Math.sign(tx - x) + rnd(3) - 1)), ny = Math.max(0, Math.min(C.TILE - 1, y + Math.sign(ty - y) + rnd(3) - 1))
      C.line(x, y, nx, ny, (a, b) => C.stamp(px, a, b, size, color)); x = nx; y = ny
    }
  }
  const cx = (C.TILE * .3 + rnd(C.TILE * .4)) | 0, cy = (C.TILE * .3 + rnd(C.TILE * .4)) | 0
  const E = C.EDGE, T = C.TILE
  for (let i = 0; i < T; i += 3) for (const [vx, vy, x, y] of [[i + E, E - 1, i, 0], [i + E, T + E, i, T - 1], [E - 1, i + E, 0, i], [T + E, i + E, T - 1, i]]) {
    const v = halo.px[vy * C.VIEW + vx]
    if (v !== C.EMPTY && Math.random() < .8) walk(x, y, cx, cy, v, 2)
  }
  for (let i = 0; i < 3; i++) {
    const color = rnd(C.NCOLORS), a = rnd(C.TILE), b = rnd(C.TILE)
    Math.random() < .5 ? walk(a, 0, b, C.TILE - 1, color, 2 + rnd(3)) : walk(0, a, C.TILE - 1, b, color, 2 + rnd(3))
  }
  C.stamp(px, cx, cy, 6, rnd(C.NCOLORS))
  return C.encode(px)
}
