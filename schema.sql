-- ============================================================
-- Freedom Performance OS — schema DB (Supabase)
-- Tabelle DEDICATE all'OS, separate da quelle del simulatore.
-- Riusa: public.profiles (role admin/collaborator/manager, sales_role),
--        public.is_admin(uid) [SECURITY DEFINER].
-- Tutto idempotente.
-- ============================================================

-- ---- profiles: aggiunta valore 'manager' al constraint role ----
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['ba','ch','st','cl','sm','admin','collaborator','manager']));

-- helper: reparto gestito da un manager (null se non manager)
create or replace function public.manager_role(uid uuid) returns text
language sql security definer stable set search_path=public as $$
  select sales_role from public.profiles where id=uid and role='manager';
$$;
grant execute on function public.manager_role(uuid) to authenticated, anon;

-- manager vede i profili del proprio reparto (policy ADDITIVA)
drop policy if exists "profile_select_manager" on public.profiles;
create policy "profile_select_manager" on public.profiles for select using (
  public.manager_role(auth.uid()) is not null and profiles.sales_role = public.manager_role(auth.uid())
);

-- ============================================================
-- os_entries — tracker reale giornaliero (1 riga per utente/giorno)
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
-- os_targets — obiettivi giornalieri per ruolo/KPI (editabili admin)
-- ============================================================
create table if not exists public.os_targets (
  role text not null,
  kpi text not null,
  daily numeric not null default 0,
  updated_at timestamptz default now(),
  primary key (role, kpi)
);
alter table public.os_targets enable row level security;
-- lettura: admin tutto, collaboratore/manager solo i target del proprio ruolo/reparto
drop policy if exists "ostg_select" on public.os_targets;
create policy "ostg_select" on public.os_targets for select using (
  public.is_admin(auth.uid())
  or exists(select 1 from public.profiles p where p.id=auth.uid() and p.sales_role = os_targets.role)
);
-- scrittura: solo admin
drop policy if exists "ostg_admin_write" on public.os_targets;
create policy "ostg_admin_write" on public.os_targets for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- seed placeholder (DA VALIDARE con i target reali di business)
insert into public.os_targets(role,kpi,daily) values
 ('ba','video',3),('ba','views',5000),('ba','lead',1),
 ('chatter','chat',80),('chatter','qualificati',8),('chatter','appuntamenti',2),
 ('setter','chiamate',40),('setter','fissati',5),('setter','show',3),
 ('closer','call',6),('closer','vendite',1),('closer','cash',1000),
 ('sm','vendite_team',4),('sm','cash_team',8000)
on conflict (role,kpi) do nothing;
