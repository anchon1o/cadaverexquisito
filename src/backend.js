// Escolle o servidor: Supabase se hai variables de contorno; se non, modo demo neste navegador.
const env = import.meta.env || {}
export async function createBackend() {
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    const m = await import('./backend-supabase.js')
    return m.create(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  }
  const m = await import('./backend-local.js')
  return m.create()
}
