import './style.css'
import * as C from './core.js'
import { createBackend } from './backend.js'
import { local } from './store.js'
import { t, getLang, setLang, joinList } from './i18n.js'

const app = document.querySelector('#app')
const $ = (s, root = document) => root.querySelector(s)
const esc = (s = '') => String(s).replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]))
const urlCode = () => (new URLSearchParams(location.search).get('game') || '').toUpperCase()

let api
const S = {
  game: null, tiles: [], creator: false,
  mine: null,              // {row, col} da peza que estou debuxando
  myDone: new Map(),       // "fila_col" -> píxeles das miñas pezas rematadas
  editorOpen: false, showAuthors: false,
  work: null, halo: null, tool: 'pen', brush: 2, color: 24, hist: [], fut: [],
  saveState: ''
}

// Iconas como mapas de bits de 16×16 con contorno continuo: o mesmo idioma visual que o debuxo.
const ICONS = {
  pen: '...........####...........##pp##.........##pppP#........##mppPP#.......##mmMPP##......##aaMMM##......##aaaAM##......##aaaAA##......##aaaAA##......##aaaAA##......##aaaAA##.......#wwaAA##........##WWA##..........##W##..........#.###..........................',
  eraser: '..........###............##p##..........##ppp##........##ppppp##......##pppppPP#.....##pppppPP##....##pppppPP##....##MMpppPP##....##kkMMpPP##....##kkkkMMP##....##kkkkkKM##.....#kkkkkKK##......##kkkKK##........##kKK##..........##K##............###..........',
  pick: '.........##rrr##........##rrrrr#........#RrrrrRR.......##RRrrRRR.......#RRRRRRRR......##RRRRRRR#.....##ggRRRRR##....##gggGRR###....##bggGG###.....##bbbGG##.......#bbbBB##.......##bbBB##........#bbBB##........##bb###.........#b###...........###.............',
  fill: '....................########.......##......##.....##........##....#..........#...##############..#bbbbbbbbbbbb#..##bbbbbbbbbB##...#BBmmmmmmMB#....#BBkmmmmmMB#....##BkmmmmmM#......#BkmmmmmM#......#BBmmmmmM#......##BmmmmM##.......########....................',
  undo: '.....................................##.............###............###########....#############....###......###.....###......##......##......##..............##.............###....###########.....##########...................................................',
  redo: '.........................................##..............###......###########....#############...###......###....##......###.....##......##......##..............###..............###########......##########...................................................'
}
const INK = {'a': '#ffd95a', 'A': '#f0a500', 'w': '#f3cf9a', 'W': '#d9a860', 'm': '#dfe5ee', 'M': '#9aa5b5', 'p': '#ff9bb0', 'P': '#e0506a', 'r': '#e0606e', 'R': '#9c2f40', 'g': '#d8efff', 'G': '#8cc8f2', 'b': '#4fa3e8', 'B': '#2f6fde', 'k': '#ffffff', 'K': '#c9d1dc'}
const icon = k => `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${[...ICONS[k]].map((c, i) => c === '.' ? '' : `<rect x="${i % 16}" y="${i >> 4}" width="1.03" height="1.03"${c === '#' ? '' : ` fill="${INK[c]}"`}/>`).join('')}</svg>`
const logo = `<span class="folds mini3" aria-hidden="true">${'<i></i>'.repeat(9)}</span>`

function toast(text) {
  let n = $('.toast')
  if (!n) { n = document.createElement('div'); n.className = 'toast'; n.setAttribute('role', 'status'); document.body.appendChild(n) }
  n.textContent = text; n.classList.add('show')
  clearTimeout(toast.timer); toast.timer = setTimeout(() => n.classList.remove('show'), 2600)
}
const fail = res => { if (res?.detail) console.error(res.detail); toast(t('e_' + (res?.code || 'invalid')) + (res?.detail ? ` [${res.detail}]` : '')) }

// ── Entrada ───────────────────────────────────────────────
const recent = () => { try { return JSON.parse(local.get('cx_recent')) || [] } catch { return [] } }
const remember = g => local.set('cx_recent', JSON.stringify([{ code: g.code, size: g.board_size }, ...recent().filter(r => r.code !== g.code)].slice(0, 8)))
const forget = code => local.set('cx_recent', JSON.stringify(recent().filter(r => r.code !== code)))
const pick = { size: 5, tile: 40, colors: 32, open: null }
// Icona de detalle: unha peza cunha curva feita con bloques grandes (sinxelo) ou pequenos (fino).
const detailIcon = n => { const k = n === 80 ? 1 : 2, cells = []
  for (let x = 0; x < 12; x += k) { const y = Math.round(10 - 9 * Math.sin(x / 11 * Math.PI)) ; cells.push(`<rect x="${x + 1}" y="${Math.max(1, Math.min(12 - k, y)) + .5}" width="${k}" height="${k}"/>`) }
  return `<svg viewBox="0 0 14 14" shape-rendering="crispEdges" aria-hidden="true"><rect x=".5" y=".5" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1"/>${cells.join('')}</svg>` }
// Columna de escolla: botón co valor actual e, se está aberta, a lista vertical de opcións.
const pickCol = (key, values, ico, label) => {
  const labels = { size: t('sizeL'), tile: t('detail'), colors: t('colorsLabel') }
  return `<div class="pick ${pick.open === key ? 'open' : ''}">
    <small>${labels[key]}</small>
    <button class="pickbtn" data-open="${key}" aria-expanded="${pick.open === key}">${ico(pick[key])}<span>${label(pick[key])}</span><i class="caret"></i></button>
    ${pick.open === key ? `<div class="menu">${values.map(v => `<button class="opt ${pick[key] === v ? 'on' : ''}" data-key="${key}" data-val="${v}" aria-pressed="${pick[key] === v}">${ico(v)}<span>${label(v)}</span></button>`).join('')}</div>` : ''}
  </div>`
}
const paletteIcon = n => { const cols = n === 64 ? C.BASE64 : C.BASE32, rows = n / 8; return `<svg viewBox="0 0 8 ${rows}" shape-rendering="crispEdges" aria-hidden="true">${cols.map((c, i) => `<rect x="${i % 8}" y="${i / 8 | 0}" width="1.02" height="1.02" fill="${c}"/>`).join('')}</svg>` }
const gridIcon = n => `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">${Array.from({ length: n * n }, (_, i) => `<rect x="${i % n + .12}" y="${(i / n | 0) + .12}" width=".76" height=".76"/>`).join('')}</svg>`

function renderLobby(message = '', mode = urlCode() ? 'join' : '') {
  const games = recent()
  app.innerHTML = `
  <main class="lobby">
    <div class="toplinks"><button class="link" id="help">${t('options')}</button><button class="link" id="lang">${getLang() === 'gl' ? 'Castellano' : 'Galego'}</button></div>
    <div class="folds" aria-hidden="true">${'<i></i>'.repeat(9)}</div>
    <h1>${t('appName')}</h1>
    <p class="lead">${t('tagline')}</p>
    <label class="field big"><span>${t('yourName')}</span>
      <input id="name" maxlength="40" autocomplete="nickname" placeholder="${t('namePh')}" value="${esc(local.get('cx_name') || '')}"></label>
    <p class="error" id="err">${esc(message)}</p>
    <div class="row choose">
      <button class="btn hint ${mode === 'create' ? 'sel' : ''}" id="mCreate" aria-expanded="${mode === 'create'}">${t('createShort')}</button>
      <button class="btn primary ${mode === 'join' ? 'sel' : ''}" id="mJoin" aria-expanded="${mode === 'join'}">${t('joinShort')}</button>
    </div>
    ${mode === 'create' ? `<section class="box">
      <div class="picks">
        ${pickCol('size', [3, 5, 7, 9], n => gridIcon(n), n => `${'SMLX'[[3, 5, 7, 9].indexOf(n)]}${n === 9 ? 'L' : ''} · ${n}×${n}`)}
        ${pickCol('tile', C.SIZES, n => detailIcon(n), n => t(n === 80 ? 'fine' : 'simple'))}
        ${pickCol('colors', C.PALETTES, n => paletteIcon(n), n => t('ncolors', { n }))}
      </div>
      ${pick.tile === 80 ? `<p class="boxhint warn">${t('fineNote')}</p>` : ''}
      <button class="btn hint wide" id="create">${t('create')}</button></section>` : ''}
    ${mode === 'join' ? `<section class="box"><div class="row">
      <input id="code" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${t('codePh')}" placeholder="${t('codePh')}" value="${esc(urlCode())}">
      <button class="btn primary" id="join">${t('join')}</button></div></section>` : ''}
    ${games.length ? `<section class="mine"><h2>${t('myGames')}</h2>${games.map(g => `<button class="gamerow" data-code="${esc(g.code)}">${gridIcon(g.size || 7)}<b>${esc(g.code)}</b></button>`).join('')}</section>` : ''}
    <p class="stats" id="stats"></p>
    ${api.demo ? `<p class="note">${t('demoNote')}</p>` : ''}
  </main><div id="sheet"></div>`
  api.stats().then(st => { const el = $('#stats'); if (el && st && st.games) el.innerHTML = `<i></i>${t(st.games === 1 ? 'stats1' : 'statsN', { g: st.games })}${st.drawing ? ' ' + t(st.drawing === 1 ? 'drawing1' : 'drawingN', { d: st.drawing }) : ''}` }).catch(() => {})
  const keepName = () => local.set('cx_name', $('#name').value.trim())
  const name = () => { const v = $('#name').value.trim(); if (!v) { $('#err').textContent = t('needName'); $('#name').focus(); return null } local.set('cx_name', v); return v }
  $('#lang').onclick = () => { keepName(); setLang(getLang() === 'gl' ? 'es' : 'gl'); renderLobby('', mode) }
  $('#help').onclick = showHelp
  $('#mCreate').onclick = () => { keepName(); pick.open = null; renderLobby('', mode === 'create' ? '' : 'create') }
  $('#mJoin').onclick = () => { keepName(); renderLobby('', mode === 'join' ? '' : 'join'); $('#code')?.focus() }
  document.querySelectorAll('.gamerow').forEach(b => b.onclick = () => { if (name()) enter(b.dataset.code) })
  if ($('#code')) {
    $('#code').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }
    $('#code').onkeydown = e => { if (e.key === 'Enter') $('#join').click() }
    $('#join').onclick = () => { if (name() && $('#code').value) enter($('#code').value) }
  }
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { keepName(); pick.open = pick.open === b.dataset.open ? null : b.dataset.open; renderLobby('', 'create') })
  document.querySelectorAll('.opt').forEach(b => b.onclick = () => { keepName(); pick[b.dataset.key] = +b.dataset.val; pick.open = null; renderLobby('', 'create') })
  if ($('#create')) $('#create').onclick = async () => {
    const n = name(); if (!n) return
    $('#create').disabled = true
    const res = await api.createGame({ title: '', name: n, size: pick.size, goal: pick.size * pick.size, avoidOwn: true, tileSize: pick.tile, colors: pick.colors })
    if (res.ok) return enter(res.gameCode)
    fail(res); renderLobby('', 'create')
  }
}
function showHelp() {
  sheet({ title: t('options'), html: `<ol class="help">${[1, 2, 3, 4].map(i => `<li>${t('help' + i)}</li>`).join('')}</ol>` })
}

async function enter(code) {
  const game = await api.getGame(code)
  if (!game) { forget(code); return renderLobby(t('notFound'), 'join') }
  if (!local.get('cx_name')) return renderLobby(t('needName'))
  try { history.replaceState(null, '', `?game=${code}`) } catch {}   // falla en marcos illados; non é grave
  S.game = game; remember(game)
  C.configure(game.tile_size, game.colors); S.color = C.NCOLORS === 64 ? 56 : 24; S.brush = 2
  await refreshAll()
  api.subscribe(game.id, onTileEvent, onGameEvent)
  renderGame()
  if (S.mine) openEditor()
}

// Aviso de casilla libre: vibración, pitido curto e título da lapela.
let audio = null
document.addEventListener('pointerdown', () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume() } catch {} }, { passive: true })
function ping() {
  toast(t('freeNow'))
  try { navigator.vibrate?.([120, 60, 120]) } catch {}
  try {
    if (audio) [660, 880].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + i * .14
      o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(.06, at); g.gain.exponentialRampToValueAtTime(.001, at + .13)
      o.connect(g).connect(audio.destination); o.start(at); o.stop(at + .14)
    })
  } catch {}
  if (document.hidden) { document.title = '● ' + t('freeNow'); document.addEventListener('visibilitychange', () => { document.title = 'Cadáver exquisito colectivo' }, { once: true }) }
}

function leaveGame() {
  if (S.stroke) strokeEnd()
  flushDraft(); api.unsubscribe()
  Object.assign(S, { game: null, tiles: [], creator: false, mine: null, work: null, myDone: new Map(), editorOpen: false, showAuthors: false, needFull: false, hadOpen: null })
  try { history.replaceState(null, '', location.pathname) } catch {}
  renderLobby('', '')
}
async function refreshAll() {
  if (!S.game) return
  const [tiles, mine, game] = await Promise.all([api.loadTiles(S.game.id), api.resume(S.game.id), api.getGame(S.game.code)])
  if (tiles) S.tiles = tiles
  if (game) { if (game.status === 'revealed' && S.game.status !== 'revealed') S.needFull = true; S.game = game }
  S.creator = mine.creator
  S.myDone = new Map(mine.mine.map(m => [`${m.row}_${m.col}`, m.pixels]))
  if (mine.editing) {
    if (!S.mine) { S.mine = { row: mine.editing.row, col: mine.editing.col }; loadWork(mine.editing.draft) }
  } else if (S.mine) lostReservation()
}
function onTileEvent(row) {
  if (!row) return refreshAll().then(paintGame)
  const i = S.tiles.findIndex(x => x.id === row.id)
  if (i >= 0) S.tiles[i] = { ...S.tiles[i], ...row }
  if (S.mine && row.row_no === S.mine.row && row.col_no === S.mine.col && row.status === 'open') lostReservation()
  paintGame()
}
async function onGameEvent(game) {
  if (S.game.status !== 'revealed' && game.status === 'revealed') { await refreshAll(); paintGame() }
  else S.game = { ...S.game, ...game }
}
function lostReservation() {
  if (!S.mine) return
  S.mine = null; S.work = null
  if (S.editorOpen) { closeEditor(); toast(t('lostLock')) }
}

// ── Taboleiro ─────────────────────────────────────────────
function renderGame() {
  const revealed = S.game.status === 'revealed'
  app.innerHTML = `
  <header class="bar">
    <button class="homebtn" id="home" aria-label="${t('menu')}" title="${t('menu')}">${logo}<span class="wordmark">Cadáver<br>exquisito</span></button>
    <div class="barbtns"><button class="btn small" id="helpG" aria-label="${t('options')}">?</button><button class="btn small" id="share">${t('share')}</button></div>
  </header>
  <main class="stage ${revealed ? 'is-revealed' : ''}">
    <div class="coderow"><span>${t('codePh')}</span><button class="codechip" id="codechip" aria-label="${t('codePh')} ${S.game.code}">${[...S.game.code].map(c => `<i>${c}</i>`).join('')}</button></div>
    <div class="status" id="status"></div>
    <div class="board" id="board" style="--n:${S.game.board_size}"></div>
    <div id="under"></div>
  </main>
  <div id="sheet"></div>
  <div id="editor" class="editor" hidden></div>`
  $('#share').onclick = share
  $('#helpG').onclick = showHelp
  $('#home').onclick = leaveGame
  $('#codechip').onclick = async () => { try { await navigator.clipboard.writeText(S.game.code); toast(t('codeCopied')) } catch { toast(S.game.code) } }
  paintGame(true)
}

function paintGame(first = false) {
  if (!$('#board') || !S.game) return
  if (S.needFull) { S.needFull = false; S.editorOpen = false; return renderGame() }
  const revealed = S.game.status === 'revealed', now = Date.now(), done = C.doneCount(S.tiles)
  const board = $('#board'), n = S.game.board_size
  board.innerHTML = ''
  const ownKeys = new Set(S.myDone.keys())
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const tile = C.tileAt(S.tiles, r, c); if (!tile) continue
    const isMine = S.mine && S.mine.row === r && S.mine.col === c
    let state = revealed ? (tile.art ? 'art' : 'void') : C.cellState(S.tiles, tile, now)
    if (state === 'open' && S.game.avoid_own && C.ownRuleApplies(S.tiles, tile, ownKeys)) state = 'own'
    const b = document.createElement('button')
    b.className = `cell s-${state}${isMine ? ' is-mine' : ''}`
    b.setAttribute('aria-label', `${C.tileName(r, c)}`)
    if (revealed && first) b.style.animationDelay = `${tile.ring_no * 420}ms`
    const art = revealed ? tile.art : S.myDone.get(`${r}_${c}`)
    // O taboleiro nunca amosa os marcos alleos: as pistas só se ven no editor, coa casilla xa reservada.
    if (art) {
      const cv = document.createElement('canvas'); cv.width = cv.height = C.TILE
      drawTile(cv.getContext('2d'), C.decode(art), false)
      b.appendChild(cv)
    } else if (state === 'done') b.insertAdjacentHTML('beforeend', `<span class="initial">${esc((tile.editor_name || '?').slice(0, 1).toUpperCase())}</span>`)
    if (state === 'live') b.insertAdjacentHTML('beforeend', `<span class="who">${isMine ? icon('pen') : esc((tile.editor_name || '?').slice(0, 1).toUpperCase())}</span>`)
    if (revealed && S.showAuthors && tile.art) b.insertAdjacentHTML('beforeend', `<span class="author">${esc(tile.editor_name || '')}</span>`)
    b.onclick = () => tapCell(tile, state)
    board.appendChild(b)
  }

  const rings = (n - 1) / 2, ring = C.activeRing(S.tiles)
  const anyOpen = S.tiles.some(x => C.cellState(S.tiles, x, now) === 'open' && !(S.game.avoid_own && C.ownRuleApplies(S.tiles, x, ownKeys)))
  if (!revealed && !S.mine && anyOpen && S.hadOpen === false) ping()
  S.hadOpen = revealed || S.mine ? null : anyOpen
  if (revealed) {
    const people = new Set(S.tiles.filter(x => x.art).map(x => x.editor_name)).size
    $('#status').innerHTML = `<h1>${t('revealedHead')}</h1><p>${t('revealedSub', { d: done, p: people })}</p>`
    $('#under').innerHTML = `<div class="actions"><button class="btn hint" id="proj">${t('project')}</button><button class="btn primary" id="png">${t('download')}</button>
      <button class="btn" id="auth">${t(S.showAuthors ? 'hideAuthors' : 'authors')}</button></div>`
    $('#png').onclick = downloadPng
    $('#proj').onclick = projectReveal
    $('#auth').onclick = () => { S.showAuthors = !S.showAuthors; paintGame() }
    return
  }
  $('#status').innerHTML = `
    <div class="meter" style="--p:${Math.min(100, done / S.game.goal * 100)}%"><i></i></div>
    <p><b>${t('progress', { d: done, g: S.game.goal })}</b><span>${ring === 0 ? t('ringCenter') : t('ring', { r: ring, n: rings })}</span></p>`
  $('#under').innerHTML = `
    ${S.mine ? `<button class="btn hint wide" id="cont">${t('continueMine', { t: C.tileName(S.mine.row, S.mine.col) })}</button>`
      : `<p class="tip">${t(anyOpen ? 'hintPick' : 'hintNone')}</p>`}
    <ul class="legend"><li><i class="k s-open"></i>${t('lgOpen')}</li><li><i class="k s-live"></i>${t('lgLive')}</li>
      <li><i class="k s-blocked"></i>${t('lgBlocked')}</li><li><i class="k s-done"></i>${t('lgDone')}</li></ul>
    <div class="actions">
      ${S.creator && done > 0 ? `<button class="btn ${done >= S.game.goal ? 'primary' : ''}" id="reveal">${t('reveal')}</button>` : ''}
      ${api.demo ? `<button class="btn" id="bot">${t('bot')}</button>` : ''}
    </div>`
  if ($('#cont')) $('#cont').onclick = openEditor
  if ($('#bot')) $('#bot').onclick = async () => { const r = await api.botMove(S.game.id); if (!r.ok) toast(t('hintNone')) }
  if ($('#reveal')) $('#reveal').onclick = () => sheet({
    title: t('revealTitle'), body: t('revealBody', { d: done }), ok: t('reveal'),
    run: async () => { const r = await api.reveal(S.game.id); if (!r.ok) fail(r) }
  })
}

// Peza no taboleiro. frameOnly: o interior tápase cun raiado de "papel dobrado".
function drawTile(ctx, px, frameOnly) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, C.TILE, C.TILE)
  for (let i = 0; i < px.length; i++) if (px[i] !== C.EMPTY) { ctx.fillStyle = C.COLORS[px[i]]; ctx.fillRect(i % C.TILE, (i / C.TILE) | 0, 1, 1) }
  if (!frameOnly) return
  const a = C.EDGE, w = C.TILE - a * 2
  ctx.fillStyle = '#dfe4ec'; ctx.fillRect(a, a, w, w)
  ctx.fillStyle = '#c3cbd8'
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if ((x + y) % 6 === 0) ctx.fillRect(a + x, a + y, 1, 1)
}

function tapCell(tile, state) {
  const name = C.tileName(tile.row_no, tile.col_no), isMine = S.mine && S.mine.row === tile.row_no && S.mine.col === tile.col_no
  if (isMine) return openEditor()
  if (state === 'open') {
    if (S.mine) return toast(t('e_busy'))
    const halo = C.buildHalo(S.tiles, tile.row_no, tile.col_no)
    const from = C.SIDES.filter(s => halo.sides[s]).map(s => t(s))
    const hasCorner = !from.length && halo.present.some(Boolean)
    const clues = from.length ? t('cluesFrom', { s: joinList(from) }) : hasCorner ? t('cluesFrom', { s: t('corners') }) : t('cluesNone')
    return sheet({
      title: t('claimTitle', { t: name }), body: `${clues} ${t('claimBody', { m: C.LOCK_MINUTES })}`, ok: t('claim'),
      run: async () => {
        const res = await api.claim(S.game.id, tile.row_no, tile.col_no, local.get('cx_name'))
        if (!res.ok) { fail(res); return refreshAll().then(paintGame) }
        S.mine = { row: tile.row_no, col: tile.col_no }; loadWork(null)
        await refreshAll(); paintGame(); openEditor()
      }
    })
  }
  if (state === 'live') {
    const mins = Math.max(1, Math.round((Date.parse(tile.lock_expires_at) - Date.now()) / 60000))
    return sheet({
      title: t('liveTitle', { n: tile.editor_name, t: name }), body: t('liveBody', { m: mins }),
      ok: S.creator ? t('forceRelease') : null, danger: true,
      run: async () => { const r = await api.release(S.game.id, tile.row_no, tile.col_no); r.ok ? toast(t('released')) : fail(r) }
    })
  }
  if (state === 'done') return sheet({ title: t('doneTitle', { t: name, n: tile.editor_name }), body: t(S.myDone.has(`${tile.row_no}_${tile.col_no}`) ? 'doneMine' : 'doneBody') })
  if (state === 'art') return sheet({ title: t('doneTitle', { t: name, n: tile.editor_name }), body: '' })
  if (state === 'void') return
  sheet({ title: t('blockedTitle'), body: state === 'blocked' ? t('blockedBody', { n: joinList([...new Set(C.blockers(S.tiles, tile))]) }) : t(state === 'own' ? 'ownBody' : 'futureBody') })
}

function sheet({ title, body, html, ok, run, danger }) {
  const el = $('#sheet')
  el.innerHTML = `<div class="scrim"></div><div class="sheetbox" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}${html || ''}
    <div class="actions">${ok ? `<button class="btn ${danger ? 'danger' : 'hint'}" id="sOk">${esc(ok)}</button>` : ''}
    <button class="btn" id="sNo">${t(ok ? 'cancel' : 'close')}</button></div></div>`
  $('.scrim', el).onclick = $('#sNo', el).onclick = closeSheet
  if (ok) $('#sOk', el).onclick = async e => { e.target.disabled = true; await run(); closeSheet() }
  ;($('#sOk', el) || $('#sNo', el)).focus()
}
function closeSheet() { const el = $('#sheet'); if (el) el.innerHTML = '' }

async function share() {
  const url = `${location.origin}${location.pathname}?game=${S.game.code}`
  try { if (navigator.share) return await navigator.share({ title: t('appName'), url }) } catch { return }
  try { await navigator.clipboard.writeText(url); toast(t('copied')) } catch { toast(url) }
}

// Revelación para proxectar: pantalla completa, as pezas destápanse unha a unha na orde en que se debuxaron.
function projectReveal() {
  const n = S.game.board_size, done = S.tiles.filter(x => x.art).sort((a, b) => Date.parse(a.finished_at || 0) - Date.parse(b.finished_at || 0))
  const el = document.createElement('div'); el.className = 'show'
  el.innerHTML = `<div class="showboard" style="--n:${n}">${S.tiles.slice().sort((a, b) => a.row_no - b.row_no || a.col_no - b.col_no).map(x => `<div class="showcell" data-id="${x.id}"></div>`).join('')}</div>
    <p class="showcap" id="cap">${t('tapToSkip')}</p><button class="btn small showclose" id="showClose">${t('showEnd')}</button>`
  document.body.appendChild(el)
  try { el.requestFullscreen?.().catch(() => {}) } catch {}
  let i = 0, timer = null
  const step = () => {
    if (i >= done.length) { $('#cap', el).textContent = t('revealedSub', { d: done.length, p: new Set(done.map(x => x.editor_name)).size }); el.classList.add('ended'); return }
    const tile = done[i++], cellEl = el.querySelector(`[data-id="${tile.id}"]`), cv = document.createElement('canvas')
    cv.width = cv.height = C.TILE; drawTile(cv.getContext('2d'), C.decode(tile.art), false); cellEl.appendChild(cv)
    $('#cap', el).textContent = tile.editor_name || ''
    timer = setTimeout(step, Math.max(350, Math.min(1400, 40000 / done.length)))
  }
  const close = () => { clearTimeout(timer); try { document.fullscreenElement && document.exitFullscreen() } catch {} el.remove() }
  el.onclick = e => { if (e.target.id === 'showClose') return close(); clearTimeout(timer); while (i < done.length) { step(); clearTimeout(timer) } step() }
  timer = setTimeout(step, 900)
}

function downloadPng() {
  const n = S.game.board_size, k = 12, cv = document.createElement('canvas'), tmp = document.createElement('canvas')
  cv.width = cv.height = n * C.TILE * k; tmp.width = tmp.height = C.TILE
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height)
  for (const tile of S.tiles) if (tile.art) {
    drawTile(tmp.getContext('2d'), C.decode(tile.art), false)
    ctx.drawImage(tmp, tile.col_no * C.TILE * k, tile.row_no * C.TILE * k, C.TILE * k, C.TILE * k)
  }
  cv.toBlob(blob => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `cadaver-exquisito-${S.game.code}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  })
}

// ── Editor ────────────────────────────────────────────────
const draftKey = () => `cx_draft_${S.game.id}_${S.mine.row}_${S.mine.col}`
function loadWork(serverDraft) {
  const saved = local.get(draftKey())
  S.work = C.decode(C.isValid(saved) ? saved : serverDraft)
  S.hist = []; S.fut = []; S.saveState = ''
}

function openEditor() {
  if (!S.mine) return
  if (!S.work) loadWork(null)
  S.halo = C.buildHalo(S.tiles, S.mine.row, S.mine.col)
  S.editorOpen = true
  const el = $('#editor'); el.hidden = false
  el.innerHTML = `
    <div class="edbar"><button class="btn small" id="edBack" aria-label="${t('back')}">‹aria-label="${t('back')}">‹&nbsp;${t('backShort')}</button>nbsp;${t('backShort')}</button>
      ${miniMap()}<strong>${t('tile')}</strong><span id="saveState"></span>
      <span class="zoomctl"><button class="btn small" id="zOut" aria-label="${t('zoomOut')}">−</button><button class="btn small" id="zIn" aria-label="${t('zoomIn')}">+</button></span></div>
    <div class="edbody">
      <div class="canvaswrap" id="wrap"><canvas id="cv" aria-label="${t('tile', { t: '' })}"></canvas></div>
      <div class="panel">
        <div class="toolrow" id="tools">
          ${['pen', 'eraser', 'fill', 'pick'].map(k => `<button class="tool" data-tool="${k}" title="${t(k)}" aria-label="${t(k)}">${icon(k)}</button>`).join('')}
          <span class="gap"></span>
          <button class="tool" id="undo" title="${t('undo')}" aria-label="${t('undo')}">${icon('undo')}</button>
          <button class="tool" id="redo" title="${t('redo')}" aria-label="${t('redo')}">${icon('redo')}</button>
        </div>
        <div class="toolrow" id="sizes" aria-label="${t('brush')}">${C.BRUSHES.map(s => `<button class="tool size" data-size="${s}" aria-label="${t('brush')} ${s}"><i style="--s:${s}"></i></button>`).join('')}</div>
        <div class="palette ${C.NCOLORS === 64 ? 'p64' : ''}" id="palette">${C.COLORS.map((c, i) => `<button class="sw" data-color="${i}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
        <p class="tip">${t('edHint')}</p>
        <div class="actions"><button class="btn hint" id="publish">${t('publish')}</button><button class="btn" id="release">${t('release')}</button></div>
      </div>
    </div>`
  $('#edBack').onclick = closeEditor
  $('#tools').onclick = e => { const b = e.target.closest('[data-tool]'); if (b) { S.tool = b.dataset.tool; syncTools() } }
  $('#sizes').onclick = e => { const b = e.target.closest('[data-size]'); if (b) { S.brush = +b.dataset.size; syncTools() } }
  $('#palette').onclick = e => { const b = e.target.closest('[data-color]'); if (b) { S.color = +b.dataset.color; if (S.tool !== 'fill') S.tool = 'pen'; syncTools() } }
  $('#undo').onclick = () => step(S.hist, S.fut)
  $('#redo').onclick = () => step(S.fut, S.hist)
  $('#publish').onclick = askPublish
  $('#release').onclick = () => sheet({
    title: t('releaseTitle', { t: C.tileName(S.mine.row, S.mine.col) }), body: t('releaseBody'), ok: t('release'), danger: true,
    run: async () => {
      const r = await api.release(S.game.id, S.mine.row, S.mine.col); if (!r.ok) return fail(r)
      local.del(draftKey()); S.mine = null; S.work = null; closeEditor(); toast(t('released')); await refreshAll(); paintGame()
    }
  })
  const cv = $('#cv')
  cv.onpointerdown = strokeStart; cv.onpointermove = strokeMove; cv.onpointerup = cv.onpointercancel = strokeEnd
  $('#zIn').onclick = () => setZoom(zoom * 1.5); $('#zOut').onclick = () => setZoom(zoom / 1.5)
  $('#wrap').onwheel = e => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY) } }
  zoom = 1; pointers.clear(); pinch = null
  syncTools(); fitCanvas()
}
// Mapa pequeno: onde está a túa peza dentro do taboleiro.
function miniMap() {
  const n = S.game.board_size
  return `<svg class="mini" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">${S.tiles.map(x =>
    `<rect x="${x.col_no + .1}" y="${x.row_no + .1}" width=".8" height=".8" class="${x.row_no === S.mine.row && x.col_no === S.mine.col ? 'me' : x.status === 'done' ? 'dn' : ''}"/>`).join('')}</svg>`
}
function closeEditor() {
  if (S.stroke) strokeEnd()
  flushDraft()
  S.editorOpen = false; zoom = 1
  const el = $('#editor'); if (el) { el.hidden = true; el.innerHTML = '' }
  paintGame()
}
function syncTools() {
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool))
  document.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('on', +b.dataset.size === S.brush))
  document.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', +b.dataset.color === S.color))
  if ($('#undo')) { $('#undo').disabled = !S.hist.length; $('#redo').disabled = !S.fut.length }
  if ($('#saveState')) $('#saveState').textContent = S.saveState ? t(S.saveState) : ''
}

// ── Zoom: botóns, Ctrl+roda e pinza con dous dedos (que tamén despraza) ──
let cell = 8, zoom = 1, pinch = null
const pointers = new Map()
function setZoom(z, cx, cy) {
  const wrap = $('#wrap'), cv = $('#cv'); if (!wrap || !cv) return
  z = Math.max(1, Math.min(8, z))
  const r = wrap.getBoundingClientRect()
  if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2 }
  const px = wrap.scrollLeft + cx - r.left, py = wrap.scrollTop + cy - r.top      // punto do contido baixo o cursor
  const k = z / zoom; zoom = z
  const side = cell * C.VIEW * zoom
  cv.style.width = cv.style.height = side + 'px'
  wrap.scrollLeft = px * k - (cx - r.left); wrap.scrollTop = py * k - (cy - r.top)
  if ($('#zOut')) { $('#zOut').disabled = zoom <= 1; $('#zIn').disabled = zoom >= 8 }
}
function pinchStart(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size !== 2) return false
  if (S.stroke) { S.stroke = null; if (S.hist.length) S.work = S.hist.pop(); drawEditor() }   // o trazo empezado co primeiro dedo desfaise
  const [a, b] = [...pointers.values()], wrap = $('#wrap')
  pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, sl: wrap.scrollLeft, st: wrap.scrollTop }
  return true
}
function pinchMove(e) {
  if (!pointers.has(e.pointerId)) return false
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (!pinch || pointers.size !== 2) return !!pinch
  const [a, b] = [...pointers.values()], wrap = $('#wrap'), r = wrap.getBoundingClientRect()
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const z = Math.max(1, Math.min(8, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist)), k = z / pinch.zoom
  zoom = z
  const side = cell * C.VIEW * zoom; $('#cv').style.width = $('#cv').style.height = side + 'px'
  wrap.scrollLeft = (pinch.sl + pinch.mx - r.left) * k - (mx - r.left)
  wrap.scrollTop = (pinch.st + pinch.my - r.top) * k - (my - r.top)
  if ($('#zOut')) { $('#zOut').disabled = zoom <= 1; $('#zIn').disabled = zoom >= 8 }
  return true
}
function pinchEnd(e) { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null }

function fitCanvas() {
  const wrap = $('#wrap'), cv = $('#cv'); if (!wrap || !cv) return
  const room = Math.min(wrap.clientWidth, wrap.clientHeight || wrap.clientWidth)
  cell = Math.max(2, Math.floor(room / C.VIEW))
  const dpr = Math.min(3, window.devicePixelRatio || 1), side = cell * C.VIEW
  cv.style.width = cv.style.height = side * zoom + 'px'
  cv.width = cv.height = Math.round(side * dpr)
  cv.getContext('2d').setTransform(cv.width / C.VIEW, 0, 0, cv.width / C.VIEW, 0, 0)
  drawEditor()
}
function drawEditor() {
  const cv = $('#cv'); if (!cv || !S.work) return
  const ctx = cv.getContext('2d'), V = C.VIEW, E = C.EDGE, T = C.TILE, px1 = 1 / cell
  ctx.fillStyle = '#cfd6e1'; ctx.fillRect(0, 0, V, V)
  for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) {
    const inside = x >= E && x < V - E && y >= E && y < V - E, i = y * V + x
    if (inside) { const v = S.work[(y - E) * T + (x - E)]; ctx.fillStyle = v === C.EMPTY ? '#fff' : C.COLORS[v] }
    else if (S.halo.present[i]) { const v = S.halo.px[i]; ctx.fillStyle = v === C.EMPTY ? '#fff' : C.COLORS[v] }
    else if ((x + y) % 3 === 0) ctx.fillStyle = '#b9c2d0'
    else continue
    ctx.fillRect(x, y, 1.02, 1.02)
  }
  if (cell >= 6) {               // cuadrícula fina sobre a peza propia
    ctx.fillStyle = 'rgba(20,33,61,.09)'
    for (let k = 1; k < T; k++) { ctx.fillRect(E + k, E, px1, T); ctx.fillRect(E, E + k, T, px1) }
  }
  ctx.strokeStyle = '#14213d'; ctx.lineWidth = 2 * px1; ctx.strokeRect(E, E, T, T)
  ctx.strokeStyle = '#ffb703'; ctx.setLineDash([1, 1]); ctx.lineWidth = 2 * px1
  ctx.strokeRect(E * 2, E * 2, T - E * 2, T - E * 2); ctx.setLineDash([])
}

const toCell = e => {
  const r = e.currentTarget.getBoundingClientRect(), clamp = v => Math.max(0, Math.min(C.TILE - 1, v))
  const vx = Math.floor((e.clientX - r.left) / r.width * C.VIEW), vy = Math.floor((e.clientY - r.top) / r.height * C.VIEW)
  return { x: clamp(vx - C.EDGE), y: clamp(vy - C.EDGE), vx: Math.max(0, Math.min(C.VIEW - 1, vx)), vy: Math.max(0, Math.min(C.VIEW - 1, vy)) }
}
function strokeStart(e) {
  if (!S.work) return
  e.preventDefault()
  e.currentTarget.setPointerCapture(e.pointerId)
  if (pinchStart(e) || !e.isPrimary) return
  const p = toCell(e)
  if (S.tool === 'pick') {
    const inside = p.vx >= C.EDGE && p.vx < C.VIEW - C.EDGE && p.vy >= C.EDGE && p.vy < C.VIEW - C.EDGE
    const v = inside ? S.work[p.y * C.TILE + p.x] : S.halo.px[p.vy * C.VIEW + p.vx]
    if (v !== C.EMPTY) { S.color = v; S.tool = 'pen'; syncTools() }
    return
  }
  S.hist.push(S.work.slice()); if (S.hist.length > 60) S.hist.shift(); S.fut = []
  if (S.tool === 'fill') { C.flood(S.work, p.x, p.y, S.color); drawEditor(); return changed() }
  e.currentTarget.setPointerCapture(e.pointerId)
  S.stroke = p; dab(p.x, p.y); drawEditor()
}
function strokeMove(e) {
  if (pinchMove(e)) return
  if (!S.stroke || !e.isPrimary) return
  for (const ev of (e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e])) {
    const p = toCell({ currentTarget: e.currentTarget, clientX: ev.clientX, clientY: ev.clientY })
    C.line(S.stroke.x, S.stroke.y, p.x, p.y, dab); S.stroke = p
  }
  drawEditor()
}
function strokeEnd(e) { if (e) pinchEnd(e); if (S.stroke) { S.stroke = null; changed() } }
const dab = (x, y) => C.stamp(S.work, x, y, S.brush, S.tool === 'eraser' ? C.EMPTY : S.color)
function step(from, to) { if (!from.length) return; to.push(S.work.slice()); S.work = from.pop(); drawEditor(); changed() }

let draftTimer = null
function changed() {
  local.set(draftKey(), C.encode(S.work))
  S.saveState = 'saving'; syncTools()
  clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 1500)
}
async function flushDraft() {
  clearTimeout(draftTimer); draftTimer = null
  if (!S.mine || !S.work || S.saveState !== 'saving') return
  const res = await api.saveDraft(S.game.id, S.mine.row, S.mine.col, C.encode(S.work))
  if (res.code === 'not_yours') return refreshAll().then(paintGame)
  S.saveState = res.ok ? 'saved' : 'offline'; syncTools()
}

function askPublish() {
  if (C.countPainted(S.work) < C.MIN_PAINTED) return toast(t('tooLittle'))
  const name = C.tileName(S.mine.row, S.mine.col)
  const empty = C.pendingSides(S.tiles, S.mine.row, S.mine.col).filter(s => !C.sideHasInk(S.work, s)).map(s => t(s))
  sheet({
    title: t('publishTitle', { t: name }),
    body: (empty.length ? t('emptyEdges', { s: joinList(empty) }) + ' ' : '') + t('publishBody'), ok: t('publish'),
    run: async () => {
      const pixels = C.encode(S.work), { row, col } = S.mine
      const res = await api.finish(S.game.id, row, col, pixels); if (!res.ok) return fail(res)
      local.del(draftKey()); S.myDone.set(`${row}_${col}`, pixels)
      S.mine = null; S.work = null; S.saveState = ''
      toast(t('published')); await refreshAll(); closeEditor()
    }
  })
}

// ── Arranque ──────────────────────────────────────────────
window.addEventListener('resize', () => S.editorOpen && fitCanvas())
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') return closeSheet()
  if (!S.editorOpen || e.target.matches('input,select')) return
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? step(S.fut, S.hist) : step(S.hist, S.fut); return syncTools() }
  const tool = { b: 'pen', e: 'eraser', g: 'fill', i: 'pick' }[k]
  if (tool) { S.tool = tool; syncTools() }
})
setInterval(() => {
  if (!S.editorOpen || !S.mine || !$('#saveState')) return
  const me = C.tileAt(S.tiles, S.mine.row, S.mine.col), left = me?.lock_expires_at ? Date.parse(me.lock_expires_at) - Date.now() : Infinity
  if (left < 60000) { $('#saveState').textContent = t('lockSoon'); $('#saveState').classList.add('warn'); try { navigator.vibrate?.(80) } catch {} }
  else $('#saveState').classList.remove('warn')
}, 10000)
// As reservas caducan co reloxo e o tempo real pode fallar: repaso periódico.
setInterval(() => { if (S.game && S.game.status !== 'revealed' && !document.hidden) refreshAll().then(() => !S.stroke && paintGame()) }, 30000)
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.game) refreshAll().then(paintGame) })

createBackend().then(b => {
  api = b; setLang(getLang())
  const code = urlCode()
  code && local.get('cx_name') ? enter(code) : renderLobby()
})
