# Changelog — STS Performance OS

Versioni = cache del Service Worker (`sw.js`). Ogni deploy bumpa `sts-vN`.

## sts-v14 — 22 giu 2026 · Hardening notturno (infra & docs)
- **schema_marketing.sql**: cattura nel repo della tabella `marketing_months` (DDL + RLS + vincoli + trigger + seed curva H2). DB ora riproducibile.
- **deploy.sh**: deploy con auto-bump del Service Worker + validazione sintassi. Elimina il bump manuale (causa-radice dei dati in cache vecchia).
- **README** riscritto (chi-usa-cosa, DB, Piano Marketing, deploy, test, sicurezza, mappa file).
- **CHANGELOG** introdotto.
- **tests/marketing_rls_test.sh**: test RLS sicuro (anon non legge/scrive il piano).
- **tests/access_test.sh**: corretto REF Supabase (era progetto FU `cqkte…` → ora STS `sbghl…`) + header con prerequisiti.
- **archive/**: schema superati (`schema`,`schema_v2`,`schema_v3`) spostati fuori dalla root.

## sts-v13 — 22 giu 2026 · Curva H2 + vista d'insieme
- Curva obiettivi reale Giu→Dic (€550k / 110 vendite; Ago ridotto ferie, Q4 forte).
- Piano: tabella "Tutto l'H2 a colpo d'occhio" (tutti i mesi, click-to-select) + nota strategica del mese.

## sts-v12 — 22 giu 2026 · Hardening post-review (4 agenti)
- Piano: anti-crash su `rates` malformati (fallback per-campo), sanitizzazione `week_split`, selettore scenario gated solo-admin, input mai `undefined`.
- Cabina: stop ai doppi conteggi — ogni KPI sommato solo dal reparto che lo possiede (`appuntamenti_processati`/`vinti`/`cash` solo closer, `fissati` solo setter); giorni dal Piano coerenti; caveat proiezione front-loaded; banner "lead mancanti"; caveat rapporti inter-reparto.
- DB: vincoli `CHECK` (scenario/range/rates) + trigger `updated_at`/`updated_by`.

## sts-v11 — Funnel reale + piano per tutti
- Cabina: "Funnel reale del mese" con conversioni e collo di bottiglia + close-rate vs piano.
- Piano Marketing visibile (sola lettura) a collaboratori e manager.

## sts-v10 — Ponte Piano ↔ realtà
- Cabina: card "Obiettivo del mese" (fatturato reale vs obiettivo + proiezione + semaforo).

## sts-v9 — Piano mese per mese (editabile solo admin)
- Tabella Supabase `marketing_months` (Giu→Dic) + RLS write=admin/read=tutti.
- Selettore mese, edit live (obiettivo/ticket/incasso/gg/conversioni), Salva persistente; non-admin sola lettura.
- Corretto: 80k NON raggiunto a Maggio → "scenario ideale di riferimento".

## sts-v5→v8 — Piano Vendite Luglio
- Modello funnel 4 fasi + 3 scenari + distribuzione settimanale; versione interattiva; "Spesa ads" → "Budget ads".
- Fix cache: il NaN visto a schermo era una versione vecchia servita dal Service Worker.

## sts-v4 e precedenti — Base
- STS Performance OS: replica di Freedom Performance OS (Supabase dedicato, branding STS, 3 admin, login premium, 7 reparti / 36 KPI).
