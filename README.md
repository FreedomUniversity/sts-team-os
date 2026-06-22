# STS Performance OS

Centro operativo KPI del team **Sales Team Solutions**. Ogni collaboratore compila i propri numeri in ~60s da telefono; founder e manager monitorano da una **Cabina di comando**; gli admin definiscono il **Piano Marketing** mese per mese. Tutti vedono dove punta la nave.

Replica dell'architettura **Freedom Performance OS** (modello collaudato), con backend Supabase dedicato e isolato e reparti/metriche B2B STS.

**Live:** https://freedomuniversity.github.io/sts-team-os/

---

## Chi usa cosa

| Ruolo | Vede | Cosa fa |
|---|---|---|
| **Collaboratore** | Oggi · Andamento · Piano Marketing (lettura) | Compila i suoi KPI del giorno (60s). Progressi vs target, streak 🔥, saldo-gioco. |
| **Manager** | Il mio reparto · Analisi · Piano Marketing (lettura) | Monitora il proprio reparto. |
| **Admin** | Cabina · Piano Marketing (modifica) · Analisi · Team · Obiettivi · KPI & Reparti | Monitora tutto, definisce piano e target, gestisce team e metriche. |

Routing in `app.js` → `renderApp()`. Le viste sono le funzioni `view*` (es. `viewToday`, `viewAdmin`, `viewMarketingPlan`).

---

## Stack
- **Frontend:** HTML + vanilla JS + CSS, nessun framework. `supabase-js` self-hostato (`vendor/`), nessuna CDN.
- **Backend:** Supabase (Postgres + Auth + RLS + Edge Function `team-admin`).
- **Hosting:** GitHub Pages (app in root del repo).
- **PWA:** service worker cache-first (`sw.js`) + manifest installabile.

---

## Database (Supabase STS)
Project ref: **`sbghltmjgllhsgioudlv`** · URL in `app.js` (`SUPABASE_URL`/`SUPABASE_ANON`, anon = pubblica per design).

### Tabelle e schema (fonte di verità = questi file)
- **`schema_sts.sql`** — base: `profiles` (+`is_admin()`/`manager_role()`), `os_entries`, `os_targets`, `kpi_catalog` (36 KPI, 7 reparti), `target_overrides`, `os_suggestions`, RLS completa. Idempotente.
- **`schema_marketing.sql`** — `marketing_months`: Piano Marketing mensile. RLS (lettura authenticated, **scrittura solo admin**), vincoli integrità (`mm_scen_chk`/`mm_range_chk`/`mm_rates_chk`), trigger audit `mm_touch`, seed curva H2 2026. Idempotente.

### Come applicare lo schema
Via **Supabase Management API** (psql/CLI non installati in locale):
```bash
TOK=$(cat ~/.config/supabase-mgmt-token)
curl -s -X POST "https://api.supabase.com/v1/projects/sbghltmjgllhsgioudlv/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  --data-binary "$(python3 -c 'import json;print(json.dumps({"query":open("schema_marketing.sql").read()}))')"
```
Le chiavi (`anon`, `service_role`, `dbpass`, `mgmt-token`) sono in `~/.config/sts-*` / `~/.config/supabase-mgmt-token` (mai nel repo).

---

## Piano Marketing (mese per mese)
Pagina `viewMarketingPlan`. Funnel a 4 fasi (Contatti → Prime chiamate → Presentazioni → Vendite) calcolato **a ritroso** dall'obiettivo del mese. Per ogni mese Giu→Dic 2026: obiettivo, ticket, incasso %, giorni lavorativi, 3 scenari (best/real/worst), distribuzione settimanale, scenario ideale di riferimento.

- **Solo gli admin** modificano e personalizzano (selettore mese, leve, Salva → persiste per tutto il team). Non-admin: sola lettura.
- **Curva H2 di default:** €550.000 / 110 vendite (Ago ridotto per ferie, Q4 forte). Editabile in-app.
- **Ponte col reale:** la Cabina mostra "Obiettivo del mese" (fatturato reale = `vinti` × ticket, solo closer) e il "Funnel reale del mese" con conversioni e collo di bottiglia.

Robustezza: la pagina regge dati malformati (fallback per-campo, niente NaN/crash) e i numeri sono sempre coerenti.

---

## Deploy
**Sempre con lo script** (auto-bump del Service Worker → niente più dati vecchi in cache):
```bash
./deploy.sh "cosa ho cambiato"
```
Fa: valida `app.js` (`node --check`) → bumpa `sts-vN`→`sts-v(N+1)` in `sw.js` → commit + push su `main`. GitHub Pages pubblica in ~1-2 min; il team prende la nuova versione alla riapertura.

> ⚠️ **Regola:** ogni modifica a `app.js`/`styles.css`/`index.html` va deployata con `deploy.sh`. Il bump del SW è la differenza tra "il team vede le novità" e "il team resta su una cache vecchia". Modifiche solo a doc/schema possono andare con `git` normale (nessun bump necessario).

---

## Test
- **`tests/marketing_rls_test.sh`** — sicuro, senza credenziali: verifica che l'anon non legga/scriva `marketing_months`.
- **`tests/access_test.sh`** — RLS end-to-end su `os_entries`/`os_targets`. ⚠️ richiede un test-user STS reale (vedi header dello script).

---

## Sicurezza
- Nei file pubblici vive **solo la anon key** (pubblica per design). Il `service_role` non è mai nel repo.
- RLS attiva su tutte le tabelle. `marketing_months`: lettura authenticated, scrittura solo `is_admin()`. Verificato con test live (anon bloccato in lettura e scrittura).

---

## Mappa file
```
app.js                  app completa (router + viste)
index.html styles.css sw.js   shell + stile + service worker
manifest.webmanifest  logo-*.png            PWA
schema_sts.sql          schema base + seed reparti
schema_marketing.sql    schema Piano Marketing (marketing_months)
edge/team-admin.ts      edge function gestione team (solo admin, service_role server-side)
tests/                  access_test.sh · marketing_rls_test.sh
deploy.sh               deploy con auto-bump SW
archive/                schema superati (storico, non applicare)
```
