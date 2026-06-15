-- =====================================================================
-- STS Performance OS — schema consolidato (Supabase progetto STS)
-- Progetto STANDALONE: crea base profiles + is_admin (FU le ereditava
-- dal simulatore; qui non esiste). DDL/RLS identici al modello FU (provati).
-- Seed kpi_catalog = reparti B2B Sales Team Solutions (NON FU).
-- Tutto idempotente.
-- =====================================================================

-- ============================================================
-- 0. BASE — profiles + is_admin + manager_role + trigger signup
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'collaborator',
  sales_role text,
  active boolean default true,
  trackable boolean default true,
  department text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin','collaborator','manager']));

create or replace function public.is_admin(uid uuid) returns boolean
language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=uid and role='admin');
$$;
grant execute on function public.is_admin(uuid) to authenticated, anon;

create or replace function public.manager_role(uid uuid) returns text
language sql security definer stable set search_path=public as $$
  select sales_role from public.profiles where id=uid and role='manager';
$$;
grant execute on function public.manager_role(uuid) to authenticated, anon;

-- self read/update; admin tutto; manager vede il proprio reparto
drop policy if exists profile_self_select on public.profiles;
create policy profile_self_select on public.profiles for select using (auth.uid()=id);
drop policy if exists profile_self_update on public.profiles;
create policy profile_self_update on public.profiles for update using (auth.uid()=id) with check (auth.uid()=id);
drop policy if exists profile_admin_all on public.profiles;
create policy profile_admin_all on public.profiles for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists "profile_select_manager" on public.profiles;
create policy "profile_select_manager" on public.profiles for select using (
  public.manager_role(auth.uid()) is not null and profiles.sales_role = public.manager_role(auth.uid())
);

-- profilo auto alla creazione utente (team-admin poi fa upsert dei dettagli)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 1. os_entries — tracker reale giornaliero (1 riga utente/giorno)
-- ============================================================
create table if not exists public.os_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  day date not null,
  kpis jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, day)
);
create index if not exists os_entries_day on public.os_entries(day);
create index if not exists os_entries_user_day on public.os_entries(user_id, day);
alter table public.os_entries enable row level security;
drop policy if exists "os_own_all" on public.os_entries;
create policy "os_own_all" on public.os_entries for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "os_admin_select" on public.os_entries;
create policy "os_admin_select" on public.os_entries for select using (public.is_admin(auth.uid()));
drop policy if exists "os_manager_select" on public.os_entries;
create policy "os_manager_select" on public.os_entries for select using (
  os_entries.role = public.manager_role(auth.uid())
);

-- ============================================================
-- 2. os_targets — legacy (kpi_catalog.daily è la fonte reale)
-- ============================================================
create table if not exists public.os_targets (
  role text not null,
  kpi text not null,
  daily numeric not null default 0,
  updated_at timestamptz default now(),
  primary key (role, kpi)
);
alter table public.os_targets enable row level security;
drop policy if exists "ostg_select" on public.os_targets;
create policy "ostg_select" on public.os_targets for select using (
  public.is_admin(auth.uid())
  or exists(select 1 from public.profiles p where p.id=auth.uid() and p.sales_role = os_targets.role)
);
drop policy if exists "ostg_admin_write" on public.os_targets;
create policy "ostg_admin_write" on public.os_targets for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ============================================================
-- 3. kpi_catalog — fonte di verità reparti/KPI (con metriche calcolate)
-- ============================================================
create table if not exists public.kpi_catalog (
  role        text not null,
  kpi_key     text not null,
  dept        text not null default '',
  role_label  text not null,
  role_icon   text not null default '•',
  role_sort   int  not null default 99,
  label       text not null,
  descr       text default '',
  unit        text not null default 'n',   -- n | € | % | bool | txt
  daily       numeric default 0,
  monthly     numeric,
  is_north    boolean default false,
  sort        int default 0,
  active      boolean default true,
  source      text default 'sts_v1',
  kind        text default 'input',        -- input | calc
  formula     text,                         -- "numKey/denKey" per kind=calc
  alert       numeric,                      -- soglia alert (es. 0.5 = 50%)
  updated_at  timestamptz default now(),
  primary key (role, kpi_key)
);
alter table public.kpi_catalog enable row level security;
drop policy if exists kpi_catalog_read on public.kpi_catalog;
create policy kpi_catalog_read on public.kpi_catalog for select to authenticated using (true);
drop policy if exists kpi_catalog_write on public.kpi_catalog;
create policy kpi_catalog_write on public.kpi_catalog for all to authenticated
  using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
  with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

-- ============================================================
-- 4. target_overrides — target per singolo collaboratore
-- ============================================================
create table if not exists public.target_overrides (
  user_id   uuid not null references auth.users(id) on delete cascade,
  kpi_key   text not null,
  daily     numeric not null,
  updated_at timestamptz default now(),
  primary key (user_id, kpi_key)
);
alter table public.target_overrides enable row level security;
drop policy if exists tov_read_self on public.target_overrides;
create policy tov_read_self on public.target_overrides for select to authenticated
  using (user_id = auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','manager')));
drop policy if exists tov_write_admin on public.target_overrides;
create policy tov_write_admin on public.target_overrides for all to authenticated
  using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
  with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

-- ============================================================
-- 5. os_suggestions — pre-compilazione (service_role scrive, bypassa RLS)
-- ============================================================
create table if not exists public.os_suggestions (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kpis jsonb not null default '{}'::jsonb,
  source text default 'precompile',
  updated_at timestamptz default now(),
  primary key (user_id, day)
);
alter table public.os_suggestions enable row level security;
drop policy if exists os_sugg_self on public.os_suggestions;
create policy os_sugg_self on public.os_suggestions for select using (auth.uid()=user_id);
drop policy if exists os_sugg_admin on public.os_suggestions;
create policy os_sugg_admin on public.os_suggestions for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ============================================================
-- 6. SEED kpi_catalog — REPARTI STS (B2B setter placement / outreach)
-- ⚠️ daily = STIME, NON validati su dati reali STS. Da tarare con Lorenzo.
-- ============================================================
insert into public.kpi_catalog (role,kpi_key,dept,role_label,role_icon,role_sort,label,descr,unit,daily,is_north,sort,active,source,kind,formula,alert) values
-- OUTREACHER (outbound social/DM B2B: IG/FB/LinkedIn/WA/Email)
('outreacher','chat_inviate','Outreach','Outreacher','💬',10,'Chat inviate','Conversazioni outbound aperte oggi','n',100,false,1,true,'sts_v1','input',null,null),
('outreacher','risposte','Outreach','Outreacher','💬',10,'Risposte ricevute','Risposte ottenute oggi','n',20,false,2,true,'sts_v1','input',null,null),
('outreacher','lead_qualificati','Outreach','Outreacher','💬',10,'Lead qualificati','Lead qualificati (3 domande) pronti per il setter','n',8,true,3,true,'sts_v1','input',null,null),
('outreacher','call_fissate','Outreach','Outreacher','💬',10,'Call fissate (handoff)','Call di diagnosi fissate / passate al setter','n',2,false,4,true,'sts_v1','input',null,null),
('outreacher','tasso_risposta','Outreach','Outreacher','💬',10,'Tasso risposta','Calcolato: risposte / chat inviate','%',0,false,5,true,'sts_v1','calc','risposte/chat_inviate',0.1),
-- SETTER (discovery call aziende clienti)
('setter','chiamate_eff','Setter','Setter','📞',20,'Chiamate effettuate','Chiamate in uscita fatte oggi','n',60,false,1,true,'sts_v1','input',null,null),
('setter','chiamate_risp','Setter','Setter','📞',20,'Chiamate risposte','Persone che hanno risposto','n',30,false,2,true,'sts_v1','input',null,null),
('setter','appuntamenti_fissati','Setter','Setter','📞',20,'Appuntamenti fissati','Call diagnosi fissate oggi','n',4,true,3,true,'sts_v1','input',null,null),
('setter','appuntamenti_processati','Setter','Setter','📞',20,'Appuntamenti presentati','Si sono presentati alla call','n',3,false,4,true,'sts_v1','input',null,null),
('setter','tasso_risposta','Setter','Setter','📞',20,'Tasso risposta','Calcolato: risposte / chiamate','%',0,false,5,true,'sts_v1','calc','chiamate_risp/chiamate_eff',null),
('setter','show_up','Setter','Setter','📞',20,'Tasso presenza (show-up)','Calcolato: presentati / fissati','%',0,false,6,true,'sts_v1','calc','appuntamenti_processati/appuntamenti_fissati',0.5),
-- CLOSER (chiusura clienti B2B — Hiring Program ticket ~5.500€)
('closer','appuntamenti_processati','Closer','Closer','🎯',30,'Appuntamenti presentati','Call di vendita presentate','n',4,false,1,true,'sts_v1','input',null,null),
('closer','vinti','Closer','Closer','🎯',30,'Vinti','Clienti chiusi oggi','n',1,false,2,true,'sts_v1','input',null,null),
('closer','persi','Closer','Closer','🎯',30,'Persi','Call perse oggi','n',0,false,3,true,'sts_v1','input',null,null),
('closer','follow_up','Closer','Closer','🎯',30,'Follow-up aperti','Trattative in follow-up','n',3,false,4,true,'sts_v1','input',null,null),
('closer','cash_collected','Closer','Closer','🎯',30,'Cash raccolto','Incassato oggi (€)','€',3000,true,5,true,'sts_v1','input',null,null),
('closer','conversion','Closer','Closer','🎯',30,'Tasso conversione','Calcolato: vinti / presentati','%',0,false,6,true,'sts_v1','calc','vinti/appuntamenti_processati',0.3),
('closer','cash_per_call','Closer','Closer','🎯',30,'Cash per call','Calcolato: cash / presentati','€',0,false,7,true,'sts_v1','calc','cash_collected/appuntamenti_processati',null),
-- ACCOUNT / DELIVERY MANAGER (gestione clienti + placement venditori)
('account','clienti_seguiti','Account / Delivery','Account / Delivery','🤝',40,'Clienti seguiti','Clienti attivi seguiti oggi','n',8,false,1,true,'sts_v1','input',null,null),
('account','candidati_presentati','Account / Delivery','Account / Delivery','🤝',40,'Candidati presentati','Venditori presentati ai clienti','n',3,false,2,true,'sts_v1','input',null,null),
('account','placement','Account / Delivery','Account / Delivery','🤝',40,'Placement effettuati','Venditori inseriti nel cliente','n',1,true,3,true,'sts_v1','input',null,null),
('account','check_monitoraggio','Account / Delivery','Account / Delivery','🤝',40,'Check monitoraggio','Check W1/W3/W6 fatti oggi','n',5,false,4,true,'sts_v1','input',null,null),
('account','upsell','Account / Delivery','Account / Delivery','🤝',40,'Upsell / rinnovi','Upsell o rinnovi continuativo chiusi','n',1,false,5,true,'sts_v1','input',null,null),
-- RECRUITING (selezione candidati venditori)
('recruiting','candidature','Recruiting','Recruiting','🧲',50,'Candidature ricevute','Nuove candidature oggi','n',20,false,1,true,'sts_v1','input',null,null),
('recruiting','screening','Recruiting','Recruiting','🧲',50,'Screening fatti','Screening completati','n',10,false,2,true,'sts_v1','input',null,null),
('recruiting','colloqui','Recruiting','Recruiting','🧲',50,'Colloqui svolti','Colloqui di selezione','n',4,false,3,true,'sts_v1','input',null,null),
('recruiting','candidati_pronti','Recruiting','Recruiting','🧲',50,'Candidati pronti','Candidati pronti al placement nel pool','n',2,true,4,true,'sts_v1','input',null,null),
('recruiting','tasso_qualifica','Recruiting','Recruiting','🧲',50,'Tasso qualifica','Calcolato: pronti / candidature','%',0,false,5,true,'sts_v1','calc','candidati_pronti/candidature',null),
-- MARKETING (lead gen aziende + candidati)
('marketing','contenuti','Marketing','Marketing','📣',60,'Contenuti pubblicati','Contenuti pubblicati oggi','n',2,false,1,true,'sts_v1','input',null,null),
('marketing','lead_aziende','Marketing','Marketing','📣',60,'Lead aziende','Lead aziende (clienti) generati','n',15,true,2,true,'sts_v1','input',null,null),
('marketing','lead_candidati','Marketing','Marketing','📣',60,'Lead candidati','Lead candidati (venditori) generati','n',20,false,3,true,'sts_v1','input',null,null),
('marketing','campagne','Marketing','Marketing','📣',60,'Campagne attive','Campagne lanciate/gestite','n',1,false,4,true,'sts_v1','input',null,null),
('marketing','cpl','Marketing','Marketing','📣',60,'CPL medio','Costo per lead medio','€',50,false,5,true,'sts_v1','input',null,null),
-- MANAGEMENT (soci: Lorenzo / Jonni)
('sm','clienti_chiusi_team','Management','Management','🛡️',110,'Clienti chiusi team','Clienti chiusi dal reparto','n',1,false,1,true,'sts_v1','input',null,null),
('sm','placement_team','Management','Management','🛡️',110,'Placement team','Placement totali del reparto','n',2,false,2,true,'sts_v1','input',null,null),
('sm','cash_team','Management','Management','🛡️',110,'Cash team','Incassato del reparto (€)','€',8000,true,3,true,'sts_v1','input',null,null)
on conflict (role,kpi_key) do nothing;

-- riepilogo
select 'kpi_catalog rows' as t, count(*)::text as v from public.kpi_catalog
union all select 'reparti attivi', count(distinct role)::text from public.kpi_catalog where active=true
union all select 'KPI calcolate', count(*)::text from public.kpi_catalog where kind='calc';
