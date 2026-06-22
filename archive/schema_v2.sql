-- =====================================================================
-- Freedom Performance OS — schema_v2 (Team OS dinamico)
-- ADDITIVO + IDEMPOTENTE. Non distrugge nulla: os_targets/os_entries/profiles restano.
-- Trasforma KPI/ruoli da hardcoded (app.js) a data-driven (kpi_catalog).
-- Creato 13/6 sessione "APP TEAM KPI".
-- =====================================================================

-- ---------- 1. CATALOGO KPI (la nuova fonte di verità) ----------
create table if not exists public.kpi_catalog (
  role        text not null,           -- chiave ruolo (es. closer, setter, care, editing...)
  kpi_key     text not null,           -- chiave KPI (stabile, usata in os_entries.kpis jsonb)
  dept        text not null default '',-- reparto leggibile
  role_label  text not null,           -- etichetta ruolo
  role_icon   text not null default '•',
  role_sort   int  not null default 99,
  label       text not null,           -- etichetta KPI
  descr       text default '',
  unit        text not null default 'n',   -- n | € | % | bool | txt
  daily       numeric default 0,
  monthly     numeric,                 -- null => derivato (daily * giorni lavorativi)
  is_north    boolean default false,   -- KPI "stella polare" del ruolo
  sort        int default 0,
  active      boolean default true,
  source      text default 'default_v1', -- 'validato' (su dato reale) | 'default_v1'
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

-- ---------- 2. PROFILES: active / trackable / department ----------
alter table public.profiles add column if not exists active    boolean default true;
alter table public.profiles add column if not exists trackable boolean default true;
alter table public.profiles add column if not exists department text;

-- ---------- 3. OVERRIDE TARGET per singolo collaboratore ----------
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

-- ---------- 4. SEED CATALOGO (idempotente: DO NOTHING preserva edit admin) ----------
insert into public.kpi_catalog (role,kpi_key,dept,role_label,role_icon,role_sort,label,descr,unit,daily,is_north,sort,source) values
-- BRAND AMBASSADOR
('ba','video','Brand Ambassador','Brand Ambassador','👑',10,'Video pubblicati','Contenuti pubblicati oggi','n',3,false,1,'default_v1'),
('ba','views','Brand Ambassador','Brand Ambassador','👑',10,'Views totali','Visualizzazioni generate','n',5000,false,2,'default_v1'),
('ba','lead','Brand Ambassador','Brand Ambassador','👑',10,'Lead generati','Lead portati dai contenuti','n',1,true,3,'default_v1'),
('ba','recensioni','Brand Ambassador','Brand Ambassador','👑',10,'Recensioni portate','Recensioni raccolte','n',1,false,4,'default_v1'),
('ba','contatti','Brand Ambassador','Brand Ambassador','👑',10,'Contatti generati','Nuovi contatti','n',2,false,5,'default_v1'),
-- CHATTER
('chatter','chat','Chatter','Chatter','💬',20,'Chat gestite','Conversazioni gestite','n',100,false,1,'validato'),
('chatter','qualificati','Chatter','Chatter','💬',20,'Lead qualificati','Lead qualificati','n',10,true,2,'validato'),
('chatter','appuntamenti','Chatter','Chatter','💬',20,'Appuntamenti generati','Appuntamenti generati','n',2,false,3,'validato'),
('chatter','recensioni_tp','Chatter','Chatter','💬',20,'Recensioni Trustpilot','Recensioni raccolte (se applicabile)','n',0,false,4,'default_v1'),
('chatter','contatti','Chatter','Chatter','💬',20,'Contatti raccolti','Contatti raccolti','n',5,false,5,'default_v1'),
-- SETTER (show DISATTIVATO: non dipende dal setter)
('setter','chiamate','Setter','Setter','📞',30,'Chiamate fatte','Chiamate in uscita','n',30,false,1,'validato'),
('setter','fissati','Setter','Setter','📞',30,'Appuntamenti fissati','Appuntamenti fissati','n',5,true,2,'validato'),
('setter','followup','Setter','Setter','📞',30,'Follow-up completati','Follow-up chiusi','n',10,false,3,'default_v1'),
('setter','lead_contattati','Setter','Setter','📞',30,'Lead contattati','Lead toccati oggi','n',20,false,4,'default_v1'),
('setter','lead_recuperati','Setter','Setter','📞',30,'Lead recuperati','Lead riattivati','n',2,false,5,'default_v1'),
('setter','show','Setter','Setter','📞',30,'Appuntamenti presentati','Importabile da CRM, NON KPI primario setter','n',3,false,6,'default_v1'),
-- CLOSER
('closer','call','Closer','Closer','🎯',40,'Call di vendita','Call di vendita fatte','n',6,false,1,'validato'),
('closer','vendite','Closer','Closer','🎯',40,'Vendite chiuse','Vendite chiuse','n',1,false,2,'validato'),
('closer','cash','Closer','Closer','🎯',40,'Cash collected','Incassato (ticket medio reale Pipedrive ~1.930€)','€',2000,true,3,'validato'),
('closer','contatti','Closer','Closer','🎯',40,'Contatti generati','Contatti generati','n',1,false,4,'default_v1'),
('closer','followup_post','Closer','Closer','🎯',40,'Follow-up post-call','Follow-up dopo call','n',3,false,5,'default_v1'),
('closer','acconti','Closer','Closer','🎯',40,'Acconti raccolti','Acconti raccolti','€',500,false,6,'default_v1'),
('closer','recuperi','Closer','Closer','🎯',40,'Recuperi completati','Recuperi insoluti chiusi','n',1,false,7,'default_v1'),
-- COMMUNITY / SKOOL
('community','inseriti_skool','Community / Skool','Community / Skool','🎟️',50,'Persone inserite su Skool','Membri inseriti','n',5,false,1,'default_v1'),
('community','chat_aperte','Community / Skool','Community / Skool','🎟️',50,'Chat aperte','Chat aperte','n',20,false,2,'default_v1'),
('community','contatti','Community / Skool','Community / Skool','🎟️',50,'Contatti raccolti','Contatti raccolti','n',10,false,3,'default_v1'),
('community','contatti_qual','Community / Skool','Community / Skool','🎟️',50,'Contatti qualificati','Contatti qualificati','n',5,false,4,'default_v1'),
('community','membri_attivati','Community / Skool','Community / Skool','🎟️',50,'Membri attivati','Membri resi attivi','n',3,true,5,'default_v1'),
('community','messaggi','Community / Skool','Community / Skool','🎟️',50,'Messaggi inviati','Messaggi inviati','n',50,false,6,'default_v1'),
('community','followup','Community / Skool','Community / Skool','🎟️',50,'Follow-up completati','Follow-up chiusi','n',10,false,7,'default_v1'),
-- CUSTOMER CARE
('care','recensioni_tp','Customer Care','Customer Care','💚',60,'Recensioni Trustpilot','Recensioni raccolte','n',2,true,1,'default_v1'),
('care','video_test','Customer Care','Customer Care','💚',60,'Video testimonianze','Video testimonianza raccolti','n',1,false,2,'default_v1'),
('care','studenti_supportati','Customer Care','Customer Care','💚',60,'Studenti supportati','Studenti seguiti oggi','n',10,false,3,'default_v1'),
('care','richieste_risolte','Customer Care','Customer Care','💚',60,'Richieste risolte','Ticket/richieste chiuse','n',15,false,4,'default_v1'),
('care','onboarding','Customer Care','Customer Care','💚',60,'Onboarding completati','Onboarding nuovi studenti','n',2,false,5,'default_v1'),
('care','solleciti','Customer Care','Customer Care','💚',60,'Solleciti inviati','Solleciti inviati','n',5,false,6,'default_v1'),
('care','casi_critici','Customer Care','Customer Care','💚',60,'Casi critici gestiti','Casi critici gestiti','n',1,false,7,'default_v1'),
-- VIDEO EDITING
('editing','video_montati','Video Editing','Video Editing','🎬',70,'Video montati','Video montati','n',3,true,1,'default_v1'),
('editing','reel','Video Editing','Video Editing','🎬',70,'Reel consegnati','Reel consegnati','n',2,false,2,'default_v1'),
('editing','revisioni','Video Editing','Video Editing','🎬',70,'Revisioni chiuse','Revisioni chiuse','n',3,false,3,'default_v1'),
('editing','contenuti','Video Editing','Video Editing','🎬',70,'Contenuti consegnati','Contenuti consegnati','n',4,false,4,'default_v1'),
('editing','contenuti_ritardo','Video Editing','Video Editing','🎬',70,'Contenuti in ritardo','Backlog scaduto (più basso è meglio)','n',0,false,5,'default_v1'),
('editing','thumbnail','Video Editing','Video Editing','🎬',70,'Thumbnail/grafiche','Thumbnail o grafiche consegnate','n',2,false,6,'default_v1'),
('editing','backlog','Video Editing','Video Editing','🎬',70,'Backlog aperto','Lavori aperti in coda','n',0,false,7,'default_v1'),
-- COACH / FORMAZIONE
('coach','live','Coach / Formazione','Coach / Formazione','🎓',80,'Live erogate','Live/sessioni erogate','n',1,true,1,'default_v1'),
('coach','studenti_seguiti','Coach / Formazione','Coach / Formazione','🎓',80,'Studenti seguiti','Studenti seguiti','n',8,false,2,'default_v1'),
('coach','roleplay','Coach / Formazione','Coach / Formazione','🎓',80,'Role play fatti','Role play svolti','n',3,false,3,'default_v1'),
('coach','sbloccati','Coach / Formazione','Coach / Formazione','🎓',80,'Studenti sbloccati','Studenti sbloccati','n',2,false,4,'default_v1'),
('coach','feedback','Coach / Formazione','Coach / Formazione','🎓',80,'Feedback dati','Feedback dati','n',5,false,5,'default_v1'),
('coach','testimonianze','Coach / Formazione','Coach / Formazione','🎓',80,'Testimonianze generate','Testimonianze generate','n',1,false,6,'default_v1'),
('coach','presenze','Coach / Formazione','Coach / Formazione','🎓',80,'Presenze alle live','Presenze registrate','n',10,false,7,'default_v1'),
-- MARKETING
('marketing','contenuti','Marketing','Marketing','📣',90,'Contenuti pubblicati','Contenuti pubblicati','n',2,false,1,'default_v1'),
('marketing','creativita','Marketing','Marketing','📣',90,'Creatività prodotte','Creatività prodotte','n',3,false,2,'default_v1'),
('marketing','lead','Marketing','Marketing','📣',90,'Lead generati','Lead generati','n',20,true,3,'default_v1'),
('marketing','campagne','Marketing','Marketing','📣',90,'Campagne lanciate','Campagne lanciate','n',1,false,4,'default_v1'),
('marketing','test_creativi','Marketing','Marketing','📣',90,'Test creativi avviati','Test creativi avviati','n',2,false,5,'default_v1'),
('marketing','cpl','Marketing','Marketing','📣',90,'CPL medio','Costo per lead medio','€',8,false,6,'default_v1'),
('marketing','landing','Marketing','Marketing','📣',90,'Landing/funnel aggiornati','Landing o funnel aggiornati','n',1,false,7,'default_v1'),
('marketing','asset','Marketing','Marketing','📣',90,'Asset consegnati','Asset consegnati','n',3,false,8,'default_v1'),
-- AMMINISTRAZIONE
('amministrazione','fatture','Amministrazione','Amministrazione','🧾',100,'Fatture emesse','Fatture emesse','n',5,false,1,'default_v1'),
('amministrazione','pagamenti','Amministrazione','Amministrazione','🧾',100,'Pagamenti verificati','Pagamenti verificati','n',10,false,2,'default_v1'),
('amministrazione','insoluti','Amministrazione','Amministrazione','🧾',100,'Insoluti gestiti','Insoluti gestiti','n',3,false,3,'default_v1'),
('amministrazione','note_credito','Amministrazione','Amministrazione','🧾',100,'Note credito gestite','Note di credito gestite','n',1,false,4,'default_v1'),
('amministrazione','report_cassa','Amministrazione','Amministrazione','🧾',100,'Report cassa aggiornati','Report cassa aggiornati','n',1,false,5,'default_v1'),
('amministrazione','pratiche','Amministrazione','Amministrazione','🧾',100,'Pratiche completate','Pratiche completate','n',5,true,6,'default_v1'),
('amministrazione','solleciti','Amministrazione','Amministrazione','🧾',100,'Solleciti inviati','Solleciti inviati','n',5,false,7,'default_v1'),
-- SALES MANAGER / MANAGEMENT
('sm','vendite_team','Management','Sales Manager','🛡️',110,'Vendite team','Vendite del reparto','n',4,false,1,'validato'),
('sm','cash_team','Management','Sales Manager','🛡️',110,'Cash team','Incassato del reparto','€',8000,true,2,'validato')
on conflict (role,kpi_key) do nothing;

-- ---------- 5. setter.show disattivato (non KPI primario setter) ----------
update public.kpi_catalog set active=false where role='setter' and kpi_key='show';

-- ---------- 6. PULIZIA: account sistema/admin = non-trackable ----------
update public.profiles set trackable=false
 where display_name in ('Amministrazione','Human Resources','Ufficio Legale',
   'Closer Team','Setter Team','Setter2','Setter3','Matteo Community','Marco Manigrassi (Spoki)')
 or role='admin';

select 'kpi_catalog rows' as t, count(*)::text from public.kpi_catalog
union all select 'ruoli distinti', count(distinct role)::text from public.kpi_catalog
union all select 'profiles non-trackable', count(*)::text from public.profiles where trackable=false;
