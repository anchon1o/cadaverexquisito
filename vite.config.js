import { defineConfig } from 'vite'

// A imaxe de previsualización (WhatsApp, Telegram…) precisa un enderezo absoluto.
// Collémolo, por esta orde, de VITE_SITE_URL, do dominio de produción de Vercel ou do despregamento actual.
const site = (process.env.VITE_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL && 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL)
  || (process.env.VERCEL_URL && 'https://' + process.env.VERCEL_URL)
  || '').replace(/\/$/, '')

export default defineConfig({
  plugins: [{
    name: 'site-url',
    transformIndexHtml: html => html.replaceAll('__SITE__', site)
  }]
})
