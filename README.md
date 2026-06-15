# STS Performance OS

Centro operativo KPI del team **Sales Team Solutions**. Ogni collaboratore compila i propri numeri in 60s da telefono; founder e manager monitorano da una Cabina di comando.

Replica dell'architettura **Freedom Performance OS** (modello collaudato), con backend Supabase dedicato e isolato, reparti/metriche B2B STS.

## Stack
- Frontend: HTML + vanilla JS + CSS (no framework). supabase-js self-hostato (`vendor/`), nessuna CDN.
- Backend: Supabase (Postgres + Auth + RLS + Edge Function `team-admin`).
- Hosting: GitHub Pages (OS in root).
- PWA: service worker cache-first (`sw.js`), manifest installabile.

## Reparti (kpi_catalog)
Outreacher · Setter · Closer · Account / Delivery · Recruiting · Marketing · Management.
Metriche `input` + `calc` (tassi/conversioni calcolati via formula). Target attuali = stime `sts_v1`, da tarare su dati reali con Lorenzo.

## File chiave
- `schema_sts.sql` — schema consolidato (base profiles + RLS + kpi_catalog + seed STS). Idempotente.
- `edge/team-admin.ts` — gestione team lato server (solo admin), usa service_role server-side.
- `app.js` / `index.html` / `styles.css` — app.
- `tests/access_test.sh` — verifica RLS.

## Note sicurezza
- Nei file pubblici vive **solo la anon key** (pubblica per design). Il `service_role` non è mai nel repo.
