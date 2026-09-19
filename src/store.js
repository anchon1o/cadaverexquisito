// Almacenamento tolerante: se o navegador bloquea localStorage, segue en memoria.
const mem = new Map()
function make(kind) {
  let area = null
  try { area = globalThis[kind]; area.setItem('__cx', '1'); area.removeItem('__cx') } catch { area = null }
  return {
    get(k) { try { return area ? area.getItem(k) : (mem.get(kind + k) ?? null) } catch { return null } },
    set(k, v) { try { area ? area.setItem(k, v) : mem.set(kind + k, v) } catch { mem.set(kind + k, v) } },
    del(k) { try { area ? area.removeItem(k) : mem.delete(kind + k) } catch {} }
  }
}
export const local = make('localStorage')
export const tab = make('sessionStorage')
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16) | 0).toString(16))
}
