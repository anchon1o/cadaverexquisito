// Previsualización por partida: cando alguén comparte /s/CÓDIGO, esta función devolve
// unha páxina cos datos reais (progreso, tamaño) para WhatsApp, Telegram, Slack…
// Ás persoas rediríxeas ao xogo; aos robots dálles só as etiquetas.
const URL_SB = process.env.VITE_SUPABASE_URL
const KEY_SB = process.env.VITE_SUPABASE_ANON_KEY

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

async function ask(path) {
  const r = await fetch(`${URL_SB}/rest/v1/${path}`, { headers: { apikey: KEY_SB, Authorization: 'Bearer ' + KEY_SB } })
  return r.ok ? r.json() : null
}

export default async function handler(req, res) {
  const code = String((req.query && req.query.code) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
  const site = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host)
  const target = code ? `/?game=${code}` : '/'

  let title = 'Cadáver exquisito colectivo'
  let desc = 'Un debuxo entre moitas mans: cada persoa pinta unha peza vendo só o bordo das veciñas.'

  try {
    if (code && URL_SB && KEY_SB) {
      const games = await ask(`cx_games?code=eq.${code}&select=id,board_size,goal,status`)
      const game = games && games[0]
      if (game) {
        const tiles = await ask(`cx_tiles?select=status&game_id=eq.${game.id}`) || []
        const done = tiles.filter(t => t.status === 'done').length
        const goal = game.goal || game.board_size * game.board_size
        title = `Cadáver exquisito · ${code}`
        desc = game.status === 'revealed'
          ? `Debuxo rematado entre ${done} mans. Ábreo para velo enteiro.`
          : `${done} de ${goal} pezas debuxadas. Entra co código ${code} e fai a túa.`
      }
    }
  } catch {}

  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'public, max-age=60, s-maxage=300')
  res.status(200).send(`<!doctype html>
<html lang="gl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cadáver exquisito colectivo">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(site + '/s/' + code)}">
<meta property="og:image" content="${esc(site)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(site)}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)})</script>
</head><body style="font-family:system-ui;background:#eef1f6;color:#14213d;padding:2rem">
<p><a href="${esc(target)}">${esc(title)}</a></p>
</body></html>`)
}
