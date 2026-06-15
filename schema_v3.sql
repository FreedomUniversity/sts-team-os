-- =====================================================================
-- schema_v3 — metriche corrette + metriche CALCOLATE + riordino reparti
-- Additivo. os_entries vuoto → sicuro riscrivere i KPI dei ruoli sales.
-- =====================================================================

-- 1) colonne per metriche calcolate / tipi / alert
alter table public.kpi_catalog add column if not exists kind    text default 'input';   -- input | calc
alter table public.kpi_catalog add column if not exists formula text;                   -- "numKey/denKey" per kind=calc
alter table public.kpi_catalog add column if not exists alert   numeric;                -- soglia alert (es. 0.5 = 50%)

-- 2) riordino reparti (role_sort) secondo priorità business
update public.kpi_catalog set role_sort=10  where role='chatter';
update public.kpi_catalog set role_sort=20  where role='setter';
update public.kpi_catalog set role_sort=30  where role='closer';
update public.kpi_catalog set role_sort=40  where role='full_stack';
update public.kpi_catalog set role_sort=50  where role='ba';
update public.kpi_catalog set role_sort=60  where role='community';
update public.kpi_catalog set role_sort=70  where role='school';
update public.kpi_catalog set role_sort=80  where role='care';
update public.kpi_catalog set role_sort=90  where role='customer_success';
update public.kpi_catalog set role_sort=100 where role='coach';
update public.kpi_catalog set role_sort=110 where role='sm';
update public.kpi_catalog set role_sort=120 where role='marketing';
update public.kpi_catalog set role_sort=130 where role='editing';
update public.kpi_catalog set role_sort=140 where role='operations';
update public.kpi_catalog set role_sort=150 where role='amministrazione';
update public.kpi_catalog set role_sort=145 where role='tech';

-- 3) riscrivo SETTER (input + calcolate)
delete from public.kpi_catalog where role='setter';
insert into public.kpi_catalog (role,kpi_key,dept,role_label,role_icon,role_sort,label,descr,unit,daily,is_north,sort,active,source,kind,formula,alert) values
('setter','chiamate_eff','Setter','Setter','📞',20,'Chiamate effettuate','Quante chiamate hai fatto oggi','n',100,false,1,true,'v3','input',null,null),
('setter','chiamate_risp','Setter','Setter','📞',20,'Chiamate risposte','Quante persone ti hanno effettivamente risposto','n',60,false,2,true,'v3','input',null,null),
('setter','appuntamenti_fissati','Setter','Setter','📞',20,'Appuntamenti fissati','Appuntamenti fissati oggi','n',5,true,3,true,'v3','input',null,null),
('setter','appuntamenti_processati','Setter','Setter','📞',20,'Appuntamenti presentati','Appuntamenti che si sono presentati alla call','n',3,false,4,true,'v3','input',null,null),
('setter','tasso_risposta','Setter','Setter','📞',20,'Tasso risposta','Calcolato: risposte / chiamate','%',0,false,5,true,'v3','calc','chiamate_risp/chiamate_eff',null),
('setter','show_up','Setter','Setter','📞',20,'Tasso presenza (show-up)','Calcolato: presentati / fissati','%',0,false,6,true,'v3','calc','appuntamenti_processati/appuntamenti_fissati',0.5);

-- 4) riscrivo CLOSER (input + calcolate)
delete from public.kpi_catalog where role='closer';
insert into public.kpi_catalog (role,kpi_key,dept,role_label,role_icon,role_sort,label,descr,unit,daily,is_north,sort,active,source,kind,formula,alert) values
('closer','appuntamenti_processati','Closer','Closer','🎯',30,'Appuntamenti presentati','Call di vendita che si sono presentate','n',5,false,1,true,'v3','input',null,null),
('closer','vinti','Closer','Closer','🎯',30,'Vinti','Vendite chiuse oggi','n',1,false,2,true,'v3','input',null,null),
('closer','persi','Closer','Closer','🎯',30,'Persi','Call perse oggi','n',0,false,3,true,'v3','input',null,null),
('closer','follow_up','Closer','Closer','🎯',30,'Follow-up aperti','Trattative in follow-up','n',2,false,4,true,'v3','input',null,null),
('closer','cash_collected','Closer','Closer','🎯',30,'Cash raccolto','Incassato oggi (€)','€',2500,true,5,true,'v3','input',null,null),
('closer','conversion','Closer','Closer','🎯',30,'Tasso conversione','Calcolato: vinti / presentati','%',0,false,6,true,'v3','calc','vinti/appuntamenti_processati',0.3),
('closer','cash_per_call','Closer','Closer','🎯',30,'Cash per call','Calcolato: cash / presentati','€',0,false,7,true,'v3','calc','cash_collected/appuntamenti_processati',null);

-- 5) FULL STACK (setter + closer)
delete from public.kpi_catalog where role='full_stack';
insert into public.kpi_catalog (role,kpi_key,dept,role_label,role_icon,role_sort,label,descr,unit,daily,is_north,sort,active,source,kind,formula,alert) values
('full_stack','chiamate_eff','Full Stack','Full Stack','🧩',40,'Chiamate effettuate','Chiamate fatte oggi','n',60,false,1,true,'v3','input',null,null),
('full_stack','appuntamenti_fissati','Full Stack','Full Stack','🧩',40,'Appuntamenti fissati','Appuntamenti fissati','n',3,false,2,true,'v3','input',null,null),
('full_stack','appuntamenti_processati','Full Stack','Full Stack','🧩',40,'Appuntamenti presentati','Call presentate','n',4,false,3,true,'v3','input',null,null),
('full_stack','vinti','Full Stack','Full Stack','🧩',40,'Vinti','Vendite chiuse','n',1,false,4,true,'v3','input',null,null),
('full_stack','follow_up','Full Stack','Full Stack','🧩',40,'Follow-up aperti','Trattative in follow-up','n',2,false,5,true,'v3','input',null,null),
('full_stack','cash_collected','Full Stack','Full Stack','🧩',40,'Cash raccolto','Incassato oggi (€)','€',2500,true,6,true,'v3','input',null,null),
('full_stack','show_up','Full Stack','Full Stack','🧩',40,'Tasso presenza','presentati / fissati','%',0,false,7,true,'v3','calc','appuntamenti_processati/appuntamenti_fissati',0.5),
('full_stack','conversion','Full Stack','Full Stack','🧩',40,'Tasso conversione','vinti / presentati','%',0,false,8,true,'v3','calc','vinti/appuntamenti_processati',0.3);

-- 6) CHATTER (semplificato)
delete from public.kpi_catalog where role='chatter';
insert into public.kpi_catalog (role,kpi_key,dept,role_label,role_icon,role_sort,label,descr,unit,daily,is_north,sort,active,source,kind,formula,alert) values
('chatter','chat_gestite','Chatter','Chatter','💬',10,'Chat gestite','Conversazioni gestite oggi','n',150,false,1,true,'v3','input',null,null),
('chatter','lead_generati','Chatter','Chatter','💬',10,'Lead generati','Nuovi lead generati','n',10,true,2,true,'v3','input',null,null),
('chatter','lead_qualificati','Chatter','Chatter','💬',10,'Lead qualificati','Lead qualificati e pronti','n',5,false,3,true,'v3','input',null,null);

-- 7) CUSTOMER SUCCESS (Veronica) — sì/no + numeri
delete from public.kpi_catalog where role='customer_success';
insert into public.kpi_catalog (role,kpi_key,dept,role_label,role_icon,role_sort,label,descr,unit,daily,is_north,sort,active,source,kind,formula,alert) values
('customer_success','conferme_serali','Customer Success','Customer Success','💎',90,'Conferme serali presenze','Hai confermato tutte le presenze previste? (1=sì)','bool',1,true,1,true,'v3','input',null,null),
('customer_success','insoluti','Customer Success','Customer Success','💎',90,'Insoluti gestiti','Hai gestito tutti gli insoluti assegnati? (1=sì)','bool',1,false,2,true,'v3','input',null,null),
('customer_success','solleciti','Customer Success','Customer Success','💎',90,'Solleciti inviati','Quanti solleciti hai inviato oggi','n',5,false,3,true,'v3','input',null,null),
('customer_success','onboarding','Customer Success','Customer Success','💎',90,'Onboarding completati','Onboarding nuovi studenti completati','n',2,false,4,true,'v3','input',null,null);

select 'reparti' as t, count(distinct role)::text from public.kpi_catalog where active=true
union all select 'KPI calcolate', count(*)::text from public.kpi_catalog where kind='calc';
