-- ============================================================================
-- STS Performance OS — Piano Marketing mese-per-mese
-- Tabella `marketing_months` + RLS + vincoli integrità + trigger audit + seed H2 2026
-- IDEMPOTENTE: rieseguibile senza danni. Applicare sul progetto Supabase STS.
-- Allineato allo stato live (giugno 2026). Fonte di verità per la riproducibilità del DB.
-- ============================================================================

-- ---------- TABELLA ----------
create table if not exists public.marketing_months (
  month        text primary key,                 -- 'YYYY-MM' (es. '2026-07')
  label        text not null,                     -- 'Luglio 2026'
  obiettivo    numeric not null default 80000,    -- fatturato obiettivo del mese (€)
  ticket       numeric not null default 4900,     -- prezzo medio contratto (€)
  incasso_pct  numeric not null default 0.5,      -- quota incassata subito (0..1)
  gg_lav       int     not null default 22,       -- giorni lavorativi del mese
  rates        jsonb   not null default '{"best":{"c2pc":32,"pc2p":75,"p2v":44,"cpl":31},"real":{"c2pc":31,"pc2p":56,"p2v":35,"cpl":28},"worst":{"c2pc":31,"pc2p":52,"p2v":22,"cpl":28}}'::jsonb,
  active_scen  text    not null default 'real',   -- scenario mostrato di default: best|real|worst
  week_split   jsonb   not null default '[5,5,4,2]'::jsonb,  -- pesi distribuzione settimanale (front-load)
  sort         int     not null default 0,
  note         text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

-- ---------- RLS: lettura per tutti gli autenticati, scrittura SOLO admin ----------
alter table public.marketing_months enable row level security;

drop policy if exists mm_read on public.marketing_months;
create policy mm_read on public.marketing_months
  for select to authenticated using (true);

drop policy if exists mm_write on public.marketing_months;
create policy mm_write on public.marketing_months
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------- VINCOLI DI INTEGRITÀ (anti-dati-sporchi, anche da admin/app) ----------
alter table public.marketing_months drop constraint if exists mm_scen_chk;
alter table public.marketing_months add  constraint mm_scen_chk
  check (active_scen in ('best','real','worst'));

alter table public.marketing_months drop constraint if exists mm_range_chk;
alter table public.marketing_months add  constraint mm_range_chk
  check (obiettivo >= 0 and ticket >= 0 and incasso_pct >= 0 and incasso_pct <= 1 and gg_lav between 0 and 31);

alter table public.marketing_months drop constraint if exists mm_rates_chk;
alter table public.marketing_months add  constraint mm_rates_chk
  check (rates ? 'best' and rates ? 'real' and rates ? 'worst');

-- ---------- TRIGGER AUDIT: aggiorna updated_at/updated_by ad ogni UPDATE ----------
create or replace function public.mm_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists mm_touch_trg on public.marketing_months;
create trigger mm_touch_trg before update on public.marketing_months
  for each row execute function public.mm_touch();

-- ---------- SEED H2 2026 (curva obiettivi Giu→Dic; editabile in-app dagli admin) ----------
-- Ago ridotto (ferie aziende), Q4 forte, Dic morbido. H2 ≈ €550.000 · 110 vendite.
insert into public.marketing_months (month,label,obiettivo,gg_lav,sort,note) values
  ('2026-06','Giugno 2026',   75000,21, 6,'Avvio H2 · mese di riferimento (scenario ideale)'),
  ('2026-07','Luglio 2026',   80000,23, 7,'Mese hero · spingere forte prima delle ferie di agosto'),
  ('2026-08','Agosto 2026',   45000,21, 8,'Ferie aziende · target ridotto, si semina per settembre'),
  ('2026-09','Settembre 2026',90000,22, 9,'Ripresa post-ferie · ripartenza decisa'),
  ('2026-10','Ottobre 2026',  95000,23,10,'Q4 forte · spinta verso fine anno'),
  ('2026-11','Novembre 2026', 95000,20,11,'Q4 forte · mantenere il ritmo'),
  ('2026-12','Dicembre 2026', 70000,21,12,'Rallentamento feste · chiusura anno')
on conflict (month) do nothing;  -- non sovrascrive eventuali modifiche admin già salvate
