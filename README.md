# Cadáver exquisito colectivo

Un debuxo entre moitas mans. Cada persoa pinta unha peza de **40×40 px** vendo só os **4 px** que asoman das pezas veciñas. O conxunto queda oculto ata que se revela.

## Como se xoga

- O taboleiro medra por aneis desde o centro (1 → 9 → 25 → 49…). Salto de anel: se no anel aberto xa non queda ningunha casilla libre (todas ocupadas ou bloqueadas), pódese pasar ao seguinte, só un, e só nas casillas que xa tocan unha peza rematada.
- Tamaños: 9, 25, 49 ou 81 pezas.
- Tocas unha casilla amarela, confirmas e queda reservada para ti. Mentres debuxas, as 8 casillas que a rodean quedan bloqueadas, así que as túas pistas non cambian a metade do traballo.
- No editor ves a túa peza cun **halo de 4 px** arredor: é o que asoma das veciñas rematadas (lados e esquinas). A liña amarela descontinua marca a franxa túa que verán os demais.
- **As pezas rematadas non se ven.** No taboleiro aparecen completamente tapadas, só coa inicial de quen as fixo; o bordo das veciñas vese unicamente no editor, coa casilla xa reservada. Ti si ves as túas.
- Opción «ninguén debuxa pegado á súa propia peza» (relaxase soa se xa non queda outra casilla no anel).
- Unha peza en curso por persoa. A reserva dura uns 5 minutos sen debuxar (o editor avisa antes de caducar); o borrador gárdase no servidor e no dispositivo.
- Cando se enche o taboleiro, **revélase** o debuxo para todo o mundo, con descarga en PNG e nomes de autoría. Quen creou a partida pode revelar antes e liberar casillas atascadas.
- Editor: lapis, goma, cubo, contagotas (tamén colle cores das pistas), grosores 1/2/4/6, 32 cores (8 familias × 4 tons), desfacer/refacer. Atallos: B, E, G, I, Ctrl+Z.
- Galego e castelán.

## Probar sen servidor

Sen variables de Supabase a app arrinca en **modo demo**: a partida gárdase no navegador, cada lapela é unha persoa distinta e o botón «Simular outra persoa» enche casillas con garabatos que continúan as pistas.

```bash
npm install
npm run dev
```

## Instalación (Supabase + GitHub + Vercel)

### 1. Supabase
1. En supabase.com: **New project**. Pon un nome, un contrasinal de base de datos e a rexión (por exemplo, *West EU*). Agarda a que remate de crearse.
2. Menú lateral **SQL Editor** → **New query**. Pega o contido enteiro de `supabase/schema.sql` e preme **Run**. Ten que dicir *Success. No rows returned*.
3. **Project Settings → API** (ou **API Keys**). Copia dúas cousas:
   - **Project URL** (`https://xxxx.supabase.co`)
   - a clave pública: **anon public** (ou **Publishable key** nos proxectos novos). Nunca a `service_role`.

Non hai que activar nada máis: o propio SQL engade as táboas ao tempo real.

### 2. GitHub
1. En github.com: **New repository**, por exemplo `cadaver-exquisito`. Pode ser privado. Sen README nin .gitignore.
2. Descomprime o zip. Na páxina do repositorio baleiro: **uploading an existing file** e arrastra **o contido** do cartafol (`index.html`, `package.json`, `vercel.json`, `src/`, `supabase/`…), non o cartafol en si. **Commit changes**.
   - Non subas `node_modules` nin ningún `.env`.

Coa terminal, o equivalente é:
```bash
git init && git add . && git commit -m "Cadáver exquisito"
git branch -M main
git remote add origin https://github.com/USUARIO/cadaver-exquisito.git
git push -u origin main
```

### 3. Vercel
1. En vercel.com: **Add New → Project** e importa o repositorio. Detecta Vite só.
2. Antes de **Deploy**, abre **Environment Variables** e engade:
   - `VITE_SUPABASE_URL` = a Project URL
   - `VITE_SUPABASE_ANON_KEY` = a clave pública
3. **Deploy**. Se engades ou cambias as variables despois, hai que facer **Redeploy** para que collan.

### Comprobar
Abre a web: se xa non aparece «Modo demo» na portada, está falando con Supabase. Crea unha partida, ábrea noutro dispositivo co código e reserva unha casilla: no outro ten que aparecer «Debuxando» ao momento.

### En local (opcional)
Copia `.env.example` como `.env`, pon os dous valores e `npm install && npm run dev`.

O esquema usa o prefixo `cx_`. Se executaches o da versión anterior, as táboas `ce_` xa non se usan e pódense borrar.

## Seguridade

- As táboas públicas (`cx_games`, `cx_tiles`) non conteñen debuxos nin sesións: dunha peza rematada só se publica o marco. Debuxos, borradores e sesións están en táboas `cx_private_*` sen ningún permiso de lectura.
- O debuxo completo só pasa á columna pública `art` no momento da revelación.
- Todas as escrituras van por funcións `SECURITY DEFINER` que comproban anel activo, veciñas en edición, propiedade da reserva e formato dos píxeles.
- A sesión é un identificador aleatorio gardado no navegador. Quen crea a partida ten que usar o mesmo navegador para revelala.

## Estrutura

- `src/core.js` regras e ferramentas de debuxo, sen DOM nin rede
- `src/backend-supabase.js`, `src/backend-local.js` os dous servidores, coa mesma interface
- `src/main.js`, `src/style.css`, `src/i18n.js` a interface
