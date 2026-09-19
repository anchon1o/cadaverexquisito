import { createClient } from '@supabase/supabase-js'
import { local, uuid } from './store.js'

export function create(url, key) {
  const sb = createClient(url, key)
  let session = local.get('cx_session')
  if (!session) { session = uuid(); local.set('cx_session', session) }
  let channel = null
  const seenDone = new Set()   // pezas que xa sabemos rematadas: os seus avisos posteriores son a revelación

  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args)
    if (error) return { ok: false, code: 'network', detail: error.message }
    return data
  }
  const at = (g, r, c) => ({ p_game: g, p_row: r, p_col: c, p_session: session })

  return {
    demo: false,
    async createGame({ title, name, size, goal, avoidOwn }) {
      const { data, error } = await sb.rpc('cx_create_game', {
        p_title: title, p_creator: name, p_session: session, p_size: size, p_goal: goal, p_avoid_own: avoidOwn
      })
      return error ? { ok: false, code: 'network', detail: error.message } : { ok: true, gameCode: data }
    },
    async getGame(code) {
      const { data } = await sb.from('cx_games').select('*').eq('code', code).maybeSingle()
      return data || null
    },
    async loadTiles(gameId) {
      const { data, error } = await sb.from('cx_tiles').select('*').eq('game_id', gameId)
      if (data) for (const t of data) if (t.status === 'done') seenDone.add(t.id)
      return error ? null : data
    },
    async resume(gameId) {
      const { data } = await sb.rpc('cx_resume', { p_game: gameId, p_session: session })
      return data || { creator: false, editing: null, mine: [] }
    },
    claim: (g, r, c, name) => rpc('cx_claim_tile', { ...at(g, r, c), p_editor: name }),
    saveDraft: (g, r, c, pixels) => rpc('cx_save_draft', { ...at(g, r, c), p_pixels: pixels }),
    finish: (g, r, c, pixels) => rpc('cx_finish_tile', { ...at(g, r, c), p_pixels: pixels }),
    release: (g, r, c) => rpc('cx_release_tile', at(g, r, c)),
    reveal: g => rpc('cx_reveal', { p_game: g, p_session: session }),

    // onTile(fila) cunha casilla actualizada, ou onTile(null) = "recarga todo". onGame(partida).
    unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null } },
    subscribe(gameId, onTile, onGame) {
      if (channel) sb.removeChannel(channel)
      channel = sb.channel('cx-' + gameId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cx_tiles', filter: `game_id=eq.${gameId}` },
          async ({ new: row }) => {
            if (row.status === 'done') {
              if (seenDone.has(row.id)) return
              seenDone.add(row.id)
              // As columnas longas poden non vir no aviso: pídese a fila enteira.
              const { data } = await sb.from('cx_tiles').select('*').eq('id', row.id).maybeSingle()
              return onTile(data || null)
            }
            const { frame, art, ...meta } = row
            onTile({ ...meta, frame: null, art: null })
          })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cx_games', filter: `id=eq.${gameId}` },
          ({ new: row }) => onGame(row))
        .subscribe()
    }
  }
}
