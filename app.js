/* ===========================================================
   STS Performance OS — app.js
   Centro operativo: tracker reale + obiettivi + dashboard.
   Backend: Supabase (os_entries, profiles). Auth + RLS server-side.
   =========================================================== */
/* supabase-js self-hostato (vendor/supabase.umd.js) — niente dipendenza esm.sh, nessun flash */
const { createClient } = window.supabase;

/* ---------- CONFIG ---------- */
const SUPABASE_URL = 'https://sbghltmjgllhsgioudlv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZ2hsdG1qZ2xsaHNnaW91ZGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MDc4MjAsImV4cCI6MjA5NzA4MzgyMH0.Od053JbPpWM0QYuXq-eSUjcOFjjvFMr3K_DdOjsq58U';
const WORKDAYS_WEEK = 6;   // giorni lavorativi/settimana (placeholder, configurabile)
const WORKDAYS_MONTH = 26; // giorni lavorativi/mese (placeholder)

/* KPI + TARGET per ruolo.
   ⚙️ DINAMICO: a runtime ROLES/ROLE_ORDER vengono RICOSTRUITI da DB (kpi_catalog) via loadCatalog().
   Questo blocco resta solo come FALLBACK se il catalogo non è raggiungibile (resilienza) e per la demo. */
let ROLES = {
  chatter: { label:'Chatter', icon:'💬', north:'lead_generati',
    kpis:[ {key:'chat_gestite',label:'Chat gestite',unit:'n',daily:150},
           {key:'lead_generati',label:'Lead generati',unit:'n',daily:10},
           {key:'lead_qualificati',label:'Lead qualificati',unit:'n',daily:5} ] },
  setter:  { label:'Setter', icon:'📞', north:'appuntamenti_fissati',
    kpis:[ {key:'chiamate_eff',label:'Chiamate effettuate',unit:'n',daily:100},
           {key:'chiamate_risp',label:'Chiamate risposte',unit:'n',daily:60},
           {key:'appuntamenti_fissati',label:'Appuntamenti fissati',unit:'n',daily:5},
           {key:'appuntamenti_processati',label:'Appuntamenti presentati',unit:'n',daily:3},
           {key:'show_up',label:'Tasso presenza',unit:'%',daily:0,kind:'calc',formula:'appuntamenti_processati/appuntamenti_fissati'} ] },
  closer:  { label:'Closer', icon:'🎯', north:'cash_collected',
    kpis:[ {key:'appuntamenti_processati',label:'Appuntamenti presentati',unit:'n',daily:5},
           {key:'vinti',label:'Vinti',unit:'n',daily:1},
           {key:'follow_up',label:'Follow-up aperti',unit:'n',daily:2},
           {key:'cash_collected',label:'Cash raccolto',unit:'€',daily:2500},
           {key:'conversion',label:'Tasso conversione',unit:'%',daily:0,kind:'calc',formula:'vinti/appuntamenti_processati'} ] },
  ba:      { label:'Brand Ambassador', icon:'👑', north:'lead',
    kpis:[ {key:'video',label:'Video pubblicati',unit:'n',daily:3},
           {key:'views',label:'Views totali',unit:'n',daily:5000},
           {key:'lead', label:'Lead generati',unit:'n',daily:5} ] },
  sm:      { label:'Sales Manager', icon:'🛡️', north:'cash_team',
    kpis:[ {key:'vendite_team',label:'Vendite team',unit:'n',daily:4},
           {key:'cash_team',label:'Cash team',unit:'€',daily:8000} ] },
};
let ROLE_ORDER = ['chatter','setter','closer','ba','sm'];

/* ---------- CATALOGO DINAMICO (kpi_catalog → ROLES/ROLE_ORDER) ---------- */
// Ricostruisce ROLES e ROLE_ORDER dal DB. Admin può aggiungere reparti/KPI senza toccare il codice.
async function loadCatalog(){
  if(DEMO) return; // demo usa il fallback hardcoded
  try{
    const {data,error} = await sb.from('kpi_catalog').select('*').eq('active',true).order('role_sort').order('sort');
    if(error||!data||!data.length){ console.warn('catalog vuoto/errore, uso fallback',error); return; }
    const built={}, order=[];
    data.forEach(r=>{
      if(!built[r.role]){
        built[r.role]={label:r.role_label,icon:r.role_icon||'•',dept:r.dept||'',sort:r.role_sort??99,north:null,kpis:[]};
        order.push(r.role);
      }
      built[r.role].kpis.push({key:r.kpi_key,label:r.label,unit:r.unit||'n',daily:+r.daily||0,descr:r.descr||'',kind:r.kind||'input',formula:r.formula||null,alert:r.alert!=null?+r.alert:null});
      if(r.is_north) built[r.role].north=r.kpi_key;
    });
    Object.values(built).forEach(R=>{ if(!R.north && R.kpis[0]) R.north=R.kpis[0].key; });
    order.sort((a,b)=>built[a].sort-built[b].sort);
    ROLES=built; ROLE_ORDER=order;
  }catch(e){ console.warn('loadCatalog fail, fallback attivo',e); }
}

/* ---------- SUPABASE ---------- */
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {auth:{persistSession:true,autoRefreshToken:true}});

/* ---------- DEMO MODE (solo dati finti, nessun accesso DB — per anteprima/QA) ---------- */
const DEMO = new URLSearchParams(location.search).get('demo');
function demoFixtures(){
  const t=new Date(), ms=new Date(t.getFullYear(),t.getMonth(),1);
  const days=[]; for(let d=new Date(ms);d<=t;d.setDate(d.getDate()+1)){if(d.getDay()===0)continue;
    days.push({day:isoDay(d),kpis:{call:4+(d.getDate()%4),vendite:(d.getDate()%3===0?1:0)+(d.getDate()%5===0?1:0),cash:800+(d.getDate()*137%2600)}});}
  return {days};
}

/* ---------- STATE ---------- */
const S = { user:null, profile:null, role:null, isAdmin:false, isManager:false, view:'today', sidebarOpen:false };

/* ---------- HELPERS ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const el = (tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};
const nf = new Intl.NumberFormat('it-IT');
const fmtv = (v,unit)=> unit==='€' ? '€'+nf.format(Math.round(v)) : unit==='%' ? Math.round(v)+'%' : unit==='bool' ? (v>=1?'Sì':'No') : nf.format(Math.round(v));
// metrica calcolata: formula "numKey/denKey" → ratio (0-1), null se denom 0
function calcKpi(formula,vals){ if(!formula) return null; const p=formula.split('/'); const den=+vals[p[1]]||0; if(!den) return null; return (+vals[p[0]]||0)/den; }
function fmtCalc(v,unit){ if(v==null) return '—'; if(unit==='%') return Math.round(v*100)+'%'; if(unit==='€') return '€'+nf.format(Math.round(v)); return nf.format(Math.round(v*100)/100); }
const pad = n=>String(n).padStart(2,'0');
function isoDay(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
const today = ()=> new Date();
function monthStart(d=today()){return new Date(d.getFullYear(),d.getMonth(),1);}
function weekStart(d=today()){const x=new Date(d);const wd=(x.getDay()+6)%7;x.setDate(x.getDate()-wd);x.setHours(0,0,0,0);return x;} // lunedì
function daysBetween(a,b){return Math.floor((b-a)/86400000);}
// giorni lavorativi (lun-sab) trascorsi dall'inizio mese fino a oggi incluso
function workdaysElapsedMonth(){const s=monthStart(),t=today();let n=0;for(let d=new Date(s);d<=t;d.setDate(d.getDate()+1)){if(d.getDay()!==0)n++;}return Math.max(1,n);}
function workdaysElapsedWeek(){const s=weekStart(),t=today();let n=0;for(let d=new Date(s);d<=t;d.setDate(d.getDate()+1)){if(d.getDay()!==0)n++;}return Math.max(1,n);}
function statusOf(pct){return pct>=1?'good':pct>=0.6?'warn':'bad';}
function statusLabel(st){return st==='good'?'in linea':st==='warn'?'sotto ritmo':'in ritardo';}
function initials(name){return (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();}

/* ---------- BONUS / MALUS (gioco, pochi euro) ---------- */
const GAME = { full:2, partial:0.5, miss:-1 }; // €/giorno feriale: 100% target / compilato-sotto / non compilato
function dayEuro(compiled,pct){ if(!compiled) return GAME.miss; if(pct>=1) return GAME.full; if(pct>=0.6) return GAME.partial; return 0; }
const eur = v => (v<0?'−€':'€')+Math.abs(v).toFixed(2).replace('.',',');
/* ---------- COLORI REPARTO (badge) ---------- */
const DEPT_COL={
  ba:['#f3e8ff','#7e22ce'], chatter:['#dbeafe','#1d4ed8'], setter:['#cffafe','#0e7490'],
  closer:['#dcfce7','#15803d'], sm:['#e2e8f0','#334155'], community:['#fef3c7','#b45309'],
  care:['#d1fae5','#047857'], editing:['#fce7f3','#be185d'], coach:['#e0e7ff','#4338ca'],
  marketing:['#ffedd5','#c2410c'], amministrazione:['#f1f5f9','#475569'], tech:['#ede9fe','#6d28d9']
};
function deptBadge(role){
  const R=ROLES[role]; if(!R) return '';
  const [bg,fg]=DEPT_COL[role]||['#f1f3f6','#475067'];
  return `<span class="dept" style="background:${bg};color:${fg}">${R.icon} ${R.label}</span>`;
}

// saldo gioco su un intervallo: entriesByDay = {iso: kpisObj}
function gameStats(entriesByDay, role, fromD, toD){
  const R=ROLES[role]; if(!R) return {bal:0,plus:0,minus:0,zero:0};
  const nk=R.kpis.find(k=>k.key===R.north)||R.kpis[0]; const tgt=nk?+nk.daily:0; const tIso=isoDay(today());
  let bal=0,plus=0,minus=0,zero=0;
  for(let d=new Date(fromD); d<=toD; d.setDate(d.getDate()+1)){
    if(d.getDay()===0) continue;                       // niente domenica
    const iso=isoDay(d); const e=entriesByDay[iso];
    if(iso===tIso && !e) continue;                     // oggi non ancora compilato → nessun malus
    const compiled=!!e; const pct=(compiled&&tgt>0)?(+(e[nk.key]||0)/tgt):0;
    const v=dayEuro(compiled,pct); bal+=v; if(v>0)plus++; else if(v<0)minus++; else zero++;
  }
  return {bal,plus,minus,zero};
}

function mount(node){const r=$('#root');r.innerHTML='';r.appendChild(node);}

/* ---------- AUTH ---------- */
async function boot(){
  if(DEMO){
    S.user={id:'demo',email:'demo@salesteamsolutions.info'};
    S.profile={display_name: DEMO==='admin'?'Jonny Pancaldi':'Mario Rossi'};
    const dv=new URLSearchParams(location.search).get('view');
    if(DEMO==='admin'){S.isAdmin=true;S.view=dv||'admin';}
    else if(DEMO==='manager'){S.isManager=true;S.role='closer';S.profile={display_name:'Lorenzo Mariani'};S.view=dv||'admin';}
    else {S.role='closer';S.view=dv||'today';}
    renderApp(); return;
  }
  const {data:{session}} = await sb.auth.getSession();
  if(session){ S.user=session.user; await loadProfile(); await loadCatalog(); await loadTargets(); renderApp(); }
  else renderLogin();
  sb.auth.onAuthStateChange((_e,sess)=>{
    const was=S.user; S.user=sess?.user||null;
    if(S.user && !was){ loadProfile().then(loadCatalog).then(loadTargets).then(renderApp); }
    else if(!S.user && was){ S.profile=null;S.role=null;S.isAdmin=false; renderLogin(); }
  });
}
async function loadProfile(){
  const {data} = await sb.from('profiles').select('role,sales_role,display_name').eq('id',S.user.id).maybeSingle();
  S.profile=data||{};
  S.isAdmin = data?.role==='admin';
  S.isManager = data?.role==='manager';
  S.role = data?.sales_role||null;
}
// applica gli override target del singolo collaboratore sopra i target di catalogo
async function loadTargets(){
  if(DEMO || !S.role || !ROLES[S.role]) return;
  try{
    const {data} = await sb.from('target_overrides').select('kpi_key,daily').eq('user_id',S.user.id);
    (data||[]).forEach(o=>{const kp=ROLES[S.role]?.kpis.find(k=>k.key===o.kpi_key); if(kp)kp.daily=+o.daily;});
  }catch(e){ console.warn('overrides load fail',e); }
}

/* ---------- DATA ---------- */
async function myEntries(fromISO){
  if(DEMO) return demoFixtures().days;
  const {data} = await sb.from('os_entries').select('day,kpis').eq('user_id',S.user.id).gte('day',fromISO).order('day');
  return data||[];
}
async function myToday(){
  if(DEMO){const d=demoFixtures().days;return d.length?{kpis:d[d.length-1].kpis}:null;}
  const {data} = await sb.from('os_entries').select('id,kpis,note').eq('user_id',S.user.id).eq('day',isoDay(today())).maybeSingle();
  return data;
}
// suggerimenti pre-compilati (CloudTalk/Pipedrive) per oggi
async function mySuggestion(){
  if(DEMO) return null;
  try{
    const {data} = await sb.from('os_suggestions').select('kpis,source').eq('user_id',S.user.id).eq('day',isoDay(today())).maybeSingle();
    return data;
  }catch(e){ return null; }
}
async function saveToday(kpis,note){
  const row={user_id:S.user.id,role:S.role,day:isoDay(today()),kpis,note:note||null,updated_at:new Date().toISOString()};
  return sb.from('os_entries').upsert(row,{onConflict:'user_id,day'});
}
async function adminData(){
  if(DEMO){
    const names=[['Mario Rossi','closer'],['Agata Bruni','chatter'],['Sharon Vitale','chatter'],['Luca Verdi','setter'],['Sara Neri','setter'],['Marco Blu','closer'],['Elisa Sole','ba'],['Davide Po','ba'],['Anna Lualdi','sm']];
    const profiles=names.map((n,i)=>({id:'demo'+i,display_name:n[0],role:'collaborator',sales_role:n[1]}));
    const td=isoDay(today()); const entries=[];
    profiles.forEach((p,i)=>{ if(i%4===2)return; // alcuni non compilano oggi
      const R=ROLES[p.sales_role]; const k={}; R.kpis.forEach(kp=>k[kp.key]=Math.round(kp.daily*(0.5+(i%5)*0.22)));
      entries.push({user_id:p.id,role:p.sales_role,day:td,kpis:k});
      for(let b=1;b<8;b++){const k2={};R.kpis.forEach(kp=>k2[kp.key]=Math.round(kp.daily*(0.6+((i+b)%4)*0.2)));entries.push({user_id:p.id,role:p.sales_role,day:td,kpis:k2});}
    });
    if(S.isManager){const r=S.role;return {profiles:profiles.filter(p=>p.sales_role===r),entries:entries.filter(e=>e.role===r)};}
    return {profiles,entries};
  }
  const [{data:profiles},{data:entries}] = await Promise.all([
    sb.from('profiles').select('id,display_name,role,sales_role,active,trackable'),
    sb.from('os_entries').select('user_id,role,day,kpis').gte('day',isoDay(monthStart()))
  ]);
  return {profiles:profiles||[], entries:entries||[]};
}

/* ---------- ANALYTICS: storico esteso (cache) per grafici/periodi ---------- */
let _anCache=null;
async function analyticsData(){
  if(_anCache) return _anCache;
  if(DEMO){
    const names=[['Mario Rossi','closer'],['Agata Bruni','chatter'],['Sharon Vitale','chatter'],['Luca Verdi','setter'],['Sara Neri','setter'],['Marco Blu','closer'],['Elisa Sole','ba'],['Davide Po','ba'],['Anna Lualdi','sm']];
    const profiles=names.map((n,i)=>({id:'demo'+i,display_name:n[0],role:'collaborator',sales_role:n[1],active:true,trackable:true}));
    const entries=[]; const end=today();
    profiles.forEach((p,i)=>{
      const R=ROLES[p.sales_role]; const diligence=0.45+(i%5)*0.13; // chi compila più spesso
      for(let back=0;back<45;back++){
        const d=new Date(end);d.setDate(d.getDate()-back);
        if(d.getDay()===0)continue;                          // niente domenica
        const wd=d.getDay();
        const weekdayBoost = wd===2||wd===3?1.18:wd===5?0.8:1; // mar/mer top, ven calo
        if((Math.sin(i*9.7+back*1.3)+1)/2 > diligence) continue; // alcuni giorni non compila
        const k={};R.kpis.forEach(kp=>k[kp.key]=Math.max(0,Math.round(kp.daily*(0.55+((i+back)%5)*0.16)*weekdayBoost)));
        entries.push({user_id:p.id,role:p.sales_role,day:isoDay(d),kpis:k});
      }
    });
    _anCache={profiles,entries};
    if(S.isManager){const r=S.role;_anCache={profiles:profiles.filter(p=>p.sales_role===r),entries:entries.filter(e=>e.role===r)};}
    return _anCache;
  }
  const fromISO=isoDay(new Date(Date.now()-120*86400000));
  const [{data:profiles},{data:entries}] = await Promise.all([
    sb.from('profiles').select('id,display_name,role,sales_role,active,trackable'),
    sb.from('os_entries').select('user_id,role,day,kpis').gte('day',fromISO).order('day')
  ]);
  _anCache={profiles:profiles||[], entries:entries||[]};
  return _anCache;
}

/* ===========================================================
   VIEWS
   =========================================================== */

/* ---------- LOGIN ---------- */
function renderLogin(msg){
  const w=el('div','login-wrap');
  w.innerHTML=`<form class="login" id="lgForm">
    <div class="lg-logo"><img src="logo-512.png" alt="Sales Team Solutions"></div>
    <div class="lg-brand">STS Performance OS</div>
    <p class="lg-sub">Il centro operativo del team Sales Team Solutions.<br>Accedi con il tuo account.</p>
    <label>Email</label><input id="lgEmail" type="email" autocomplete="email" placeholder="nome@salesteamsolutions.info" required>
    <label>Password</label><input id="lgPass" type="password" autocomplete="current-password" placeholder="••••••••" required>
    <button class="btn btn-primary btn-block" type="submit" style="margin-top:20px">Entra</button>
    <div class="lg-msg ${msg?'err':''}" id="lgMsg">${msg||''}</div>
  </form>`;
  mount(w);
  $('#lgForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=$('#lgForm button'); btn.disabled=true; $('#lgMsg').className='lg-msg'; $('#lgMsg').textContent='Accesso…';
    const {error}=await sb.auth.signInWithPassword({email:$('#lgEmail').value.trim(),password:$('#lgPass').value});
    if(error){ btn.disabled=false; $('#lgMsg').className='lg-msg err'; $('#lgMsg').textContent='Credenziali non valide. Riprova.'; }
  });
}

/* ---------- SHELL ---------- */
function shell(navItems,content){
  const wrap=el('div');
  const name=S.profile?.display_name||S.user.email.split('@')[0];
  const roleLabel = S.isAdmin ? 'Admin' : (ROLES[S.role]?.label||'Collaboratore');
  wrap.innerHTML=`
  <div class="topbar"><div class="tb-brand"><img class="brand-logo" src="logo-96.png" alt="STS"> STS Performance OS</div><button class="burger" id="burger">☰</button></div>
  <div class="scrim" id="scrim"></div>
  <div class="app">
    <aside class="sidebar ${S.sidebarOpen?'open':''}" id="sidebar">
      <div class="sb-brand"><img class="brand-logo" src="logo-96.png" alt="STS"> STS Performance OS</div>
      <nav class="sb-nav">${navItems.map(n=>`<a class="sb-link ${n.id===S.view?'on':''}" data-v="${n.id}"><span class="i">${n.icon}</span>${n.label}</a>`).join('')}</nav>
      <div class="sb-foot">
        <div class="sb-user"><div class="av">${initials(name)}</div><div><div class="nm">${name}</div><div class="rl">${roleLabel}</div></div></div>
        <button class="sb-logout" id="logout">↩ Esci</button>
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  mount(wrap);
  $('#main').appendChild(content);
  wrap.querySelectorAll('.sb-link').forEach(a=>a.addEventListener('click',()=>{S.view=a.dataset.v;S.sidebarOpen=false;renderApp();}));
  $('#logout').addEventListener('click',async()=>{await sb.auth.signOut();});
  const burger=$('#burger'),scrim=$('#scrim');
  if(burger)burger.addEventListener('click',()=>{S.sidebarOpen=!S.sidebarOpen;$('#sidebar').classList.toggle('open');scrim.classList.toggle('on');});
  if(scrim)scrim.addEventListener('click',()=>{S.sidebarOpen=false;$('#sidebar').classList.remove('open');scrim.classList.remove('on');});
}

/* ---------- ROUTER ---------- */
function renderApp(){
  if(!S.user){renderLogin();return;}
  if(S.isAdmin){
    const nav=[{id:'admin',icon:'🛰️',label:'Cabina di comando'},{id:'plan',icon:'📈',label:'Piano Marketing'},{id:'analytics',icon:'📊',label:'Analisi'},{id:'roles',icon:'👥',label:'Team'},{id:'targets',icon:'🎯',label:'Obiettivi'},{id:'kpis',icon:'⚙️',label:'KPI & Reparti'}];
    if(!['admin','plan','analytics','roles','targets','kpis'].includes(S.view))S.view='admin';
    const c=el('div'); shell(nav,c);
    if(S.view==='analytics') viewAnalytics(c,'admin');
    else if(S.view==='plan') viewMarketingPlan(c);
    else if(S.view==='roles') viewTeamAssign(c);
    else if(S.view==='targets') viewTargets(c);
    else if(S.view==='kpis') viewKpiBuilder(c);
    else viewAdmin(c,'admin');
    return;
  }
  if(S.isManager){
    const nav=[{id:'admin',icon:'👥',label:'Il mio reparto'},{id:'analytics',icon:'📊',label:'Analisi'}];
    if(!['admin','analytics'].includes(S.view))S.view='admin';
    const c=el('div'); shell(nav,c);
    if(S.view==='analytics') viewAnalytics(c,'manager');
    else viewAdmin(c,'manager');
    return;
  }
  if(!S.role){ renderNotAssigned(); return; }
  const nav=[{id:'today',icon:'📌',label:'Oggi'},{id:'trend',icon:'📈',label:'Andamento'}];
  if(!['today','trend'].includes(S.view))S.view='today';
  const c=el('div'); shell(nav,c);
  if(S.view==='trend') viewTrend(c);
  else viewToday(c);
}

function renderNotAssigned(){
  const w=el('div');
  shell([{id:'today',icon:'📌',label:'Oggi'}],w);
  w.innerHTML=`<div class="page-head"><div><h1>Area non ancora assegnata</h1><p class="sub">Il tuo profilo è attivo ma non è ancora collegato a un ruolo.</p></div></div>
  <div class="banner warn">⏳ Un amministratore deve assegnarti la tua area (Brand Ambassador, Chatter, Setter, Closer o Sales Manager). Scrivi a Lorenzo o al tuo responsabile. Appena fatto, qui comparirà il tuo tracker.</div>`;
}

/* ---------- TOAST ---------- */
function toast(msg){let t=$('#toast');if(!t){t=el('div');t.id='toast';t.style.cssText='position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#0f1729;color:#fff;padding:11px 18px;border-radius:11px;font-size:14px;font-weight:600;z-index:200;box-shadow:0 12px 40px -16px rgba(0,0,0,.5);opacity:0;transition:opacity .2s';document.body.appendChild(t);}t.textContent=msg;t.style.opacity='1';clearTimeout(t._h);t._h=setTimeout(()=>t.style.opacity='0',2200);}

/* ---------- ADMIN: OBIETTIVI (editor target) ---------- */
async function viewTargets(c){
  c.innerHTML=`<div class="page-head"><div><h1>🎯 Obiettivi</h1><p class="sub">Target giornalieri per ruolo (tutti gli ${ROLE_ORDER.length} reparti). Da qui "sotto/sopra ritmo" diventa reale per il team.</p></div></div>
  <input id="tgFilter" placeholder="🔎 Filtra reparto…" style="width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:11px;margin-bottom:14px;font-size:15px">
  <div id="tgBody"></div>`;
  const body=$('#tgBody',c);
  function paint(){
    const q=($('#tgFilter',c)?.value||'').toLowerCase().trim();
    body.innerHTML='';
    ROLE_ORDER.filter(r=>!q||ROLES[r].label.toLowerCase().includes(q)||(ROLES[r].dept||'').toLowerCase().includes(q)).forEach(r=>{
      const R=ROLES[r];const card=el('div','card');card.style.marginBottom='16px';
      card.innerHTML=`<div class="card-h"><h3>${R.icon} ${R.label}</h3><span class="muted">${R.dept||''}</span></div>`;
      const form=el('div','kpi-form');
      R.kpis.forEach(k=>{
        const f=el('div','field');
        f.innerHTML=`<div class="f-lbl">${k.label}<small>${k.key===R.north?'⭐ Obiettivo guida · ':''}obiettivo giornaliero a persona</small></div><div class="f-in"><input id="tg_${r}_${k.key}" type="number" min="0" inputmode="numeric" value="${k.daily}"><span class="unit">${k.unit}</span></div>`;
        form.appendChild(f);});
      card.appendChild(form);body.appendChild(card);
    });
  }
  paint(); $('#tgFilter',c).addEventListener('input',paint);
  const row=el('div');row.style.cssText='display:flex;align-items:center;gap:12px;position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 40%);padding:14px 0';
  const save=el('button','btn btn-primary','💾 Salva tutti gli obiettivi');const msg=el('span','muted');
  row.appendChild(save);row.appendChild(msg);c.appendChild(row);
  save.addEventListener('click',async()=>{
    save.disabled=true;save.textContent='Salvo…';
    const rows=[];let touched=0;
    ROLE_ORDER.forEach(r=>ROLES[r].kpis.forEach(k=>{const inp=$('#tg_'+r+'_'+k.key,c);if(!inp)return;const nv=+(inp.value||0);if(nv!==k.daily)touched++;k.daily=nv;rows.push({role:r,kpi_key:k.key,daily:nv,updated_at:new Date().toISOString()});}));
    const {error}=await sb.from('kpi_catalog').upsert(rows,{onConflict:'role,kpi_key'});
    if(error){save.disabled=false;save.textContent='💾 Salva tutti gli obiettivi';msg.style.color='var(--bad)';msg.textContent='Errore: '+error.message;return;}
    save.textContent='✓ Salvato';msg.textContent=`Target aggiornati (${touched} modificati).`;toast('Obiettivi salvati');
    setTimeout(()=>{save.disabled=false;save.textContent='💾 Salva tutti gli obiettivi';},1600);
  });
}

/* ---------- ADMIN: TEAM / COLLABORATORI (ruolo + attivo + trackable) ---------- */
const SYSTEM_NAMES=['Amministrazione','Human Resources','Ufficio Legale','Closer Team','Setter Team','Setter2','Setter3','Matteo Community','Marco Manigrassi (Spoki)'];
async function viewTeamAssign(c){
  c.innerHTML=`<div class="page-head"><div><h1>👥 Team / Collaboratori</h1><p class="sub">Aggiungi, assegna ruolo, attiva/disattiva e decidi chi è tracciato.</p></div>
    <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="raPurge" style="display:none">🧹 Pulisci disattivati</button><button class="btn btn-primary" id="raAddBtn">➕ Aggiungi collaboratore</button></div></div>
  <div class="card" id="raAddForm" style="display:none;margin-bottom:14px">
    <div class="card-h"><h3>Nuovo collaboratore</h3></div>
    <div class="datectl" style="gap:10px">
      <input id="naName" placeholder="Nome" style="flex:1;min-width:140px;padding:9px 12px;border:1px solid var(--line);border-radius:10px">
      <input id="naEmail" type="email" placeholder="email@salesteamsolutions.info" style="flex:2;min-width:200px;padding:9px 12px;border:1px solid var(--line);border-radius:10px">
      <select id="naRole" style="padding:9px 11px;border:1px solid var(--line);border-radius:10px;font-weight:600"></select>
      <button class="btn btn-primary" id="naCreate">Crea login</button>
    </div>
    <p class="muted" style="font-size:12px;margin-top:8px">Crea l'account con password <b>CollabStore123!</b>. Il collaboratore entra subito con la sua email.</p>
    <div id="naMsg" class="muted" style="font-size:13px;margin-top:6px"></div></div>
  <input id="raSearch" placeholder="🔎 Cerca per nome…" style="width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:11px;margin-bottom:14px;font-size:14px">
  <div id="raAlert"></div>
  <div class="card" style="padding:0;overflow:auto" id="raBody"><div class="empty">Carico…</div></div>`;
  const {data}=await sb.from('profiles').select('id,display_name,role,sales_role,active,trackable').order('display_name');
  const profs=(data||[]).map(p=>({active:true,trackable:true,...p}));
  const opts=['',...ROLE_ORDER];
  // form "Aggiungi collaboratore" (via edge function team-admin)
  $('#naRole',c).innerHTML=opts.map(o=>`<option value="${o}">${o===''?'— reparto —':ROLES[o].icon+' '+ROLES[o].label}</option>`).join('');
  $('#raAddBtn',c).addEventListener('click',()=>{const f=$('#raAddForm',c);f.style.display=f.style.display==='none'?'block':'none';});
  $('#naCreate',c).addEventListener('click',async()=>{
    const name=$('#naName',c).value.trim(), email=$('#naEmail',c).value.trim(), role=$('#naRole',c).value||null;
    const msg=$('#naMsg',c); if(!name||!email){msg.style.color='var(--bad)';msg.textContent='Servono nome ed email.';return;}
    const btn=$('#naCreate',c); btn.disabled=true; btn.textContent='Creo…'; msg.style.color='var(--ink-3)'; msg.textContent='';
    const {data:r,error}=await sb.functions.invoke('team-admin',{body:{action:'create',name,email,sales_role:role}});
    btn.disabled=false; btn.textContent='Crea login';
    if(error||r?.error){msg.style.color='var(--bad)';msg.textContent='Errore: '+(r?.error||error.message);return;}
    profs.push({id:r.id,display_name:name,role:'collaborator',sales_role:role,active:true,trackable:true});
    $('#naName',c).value='';$('#naEmail',c).value='';$('#naRole',c).value='';
    msg.style.color='var(--brand)';msg.textContent='✓ '+name+' creato. Login: '+email+' / CollabStore123!';
    toast(name+' aggiunto'); render();
  });
  // pulizia disattivati (hard delete in blocco)
  const purgeBtn=$('#raPurge',c);
  function refreshPurge(){ const n=profs.filter(p=>p.active===false&&p.role!=='admin').length; if(n>0){purgeBtn.style.display='';purgeBtn.textContent='🧹 Pulisci disattivati ('+n+')';}else purgeBtn.style.display='none'; }
  refreshPurge();
  purgeBtn.addEventListener('click',async()=>{
    const n=profs.filter(p=>p.active===false&&p.role!=='admin').length;
    if(!n||!confirm('Eliminare DEFINITIVAMENTE tutti i '+n+' collaboratori disattivati?\nIrreversibile.')) return;
    purgeBtn.disabled=true; purgeBtn.textContent='Pulisco…';
    const {data:r,error}=await sb.functions.invoke('team-admin',{body:{action:'purge_inactive'}});
    purgeBtn.disabled=false;
    if(error||r?.error){toast('Errore: '+(r?.error||error.message));return;}
    for(let i=profs.length-1;i>=0;i--){ if(profs[i].active===false&&profs[i].role!=='admin') profs.splice(i,1); }
    toast((r.removed||0)+' eliminati'); refreshPurge(); render();
  });
  // profili "da verificare": sistema, admin, o nome duplicato (stesso primo token)
  const firstTok={};profs.forEach(p=>{const t=(p.display_name||'').split(' ')[0].toLowerCase();if(t)(firstTok[t]=firstTok[t]||[]).push(p.display_name);});
  const isDirty=p=> p.role==='admin'||SYSTEM_NAMES.includes(p.display_name);
  const dirtyCount=profs.filter(isDirty).length;
  const realHumans=profs.filter(p=>!isDirty(p));
  const assigned=realHumans.filter(p=>p.sales_role).length;
  $('#raAlert',c).innerHTML=`<div class="banner info" style="margin-bottom:14px;flex-wrap:wrap">👥 <span style="white-space:nowrap"><b>${realHumans.length}</b>&nbsp;persone reali</span> · <span style="white-space:nowrap"><b>${assigned}</b>&nbsp;con ruolo</span> · <span style="white-space:nowrap"><b>${realHumans.length-assigned}</b>&nbsp;senza ruolo</span> · <span style="white-space:nowrap"><b>${dirtyCount}</b>&nbsp;account sistema/admin esclusi</span></div>`;
  async function patch(id,field,value,p){
    const {error}=await sb.from('profiles').update({[field]:value}).eq('id',id);
    if(error){toast('Errore: '+error.message);return false;}
    if(p)p[field]=value;return true;
  }
  function rowHtml(p){
    const nm=p.display_name||('utente '+p.id.slice(0,8));
    const dirty=isDirty(p); const inactive=p.active===false;
    const tag = p.role==='admin'?'<span class="pill role">🛡️ Admin</span>':SYSTEM_NAMES.includes(nm)?'<span class="pill" style="background:var(--warn-soft);color:var(--warn)">⚙️ sistema</span>':inactive?'<span class="pill" style="background:var(--bad-soft);color:var(--bad)">disattivato</span>':'';
    const sel=`<select data-id="${p.id}" class="ra-sel" ${p.role==='admin'?'disabled':''} style="padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface);font-weight:600">${opts.map(o=>`<option value="${o}" ${(p.sales_role||'')===o?'selected':''}>${o===''?'— nessuno —':ROLES[o].icon+' '+ROLES[o].label}</option>`).join('')}</select>`;
    const rmBtn = p.role==='admin' ? '' : `<button class="ra-rm" data-id="${p.id}" style="color:var(--bad);font-weight:700;font-size:13px">🗑 Rimuovi</button>`;
    return `<tr style="${dirty||inactive?'opacity:.55':''}">
      <td><b>${nm}</b> ${tag}</td><td>${sel}</td>
      <td><input type="checkbox" class="ra-track" data-id="${p.id}" ${p.trackable!==false?'checked':''}></td>
      <td>${rmBtn}</td></tr>`;
  }
  function render(){
    const q=($('#raSearch',c)?.value||'').toLowerCase().trim();
    const match=profs.filter(p=>!q||(p.display_name||p.id).toLowerCase().includes(q));
    const grp=[];
    ROLE_ORDER.forEach(r=>{const g=match.filter(p=>p.sales_role===r&&p.role!=='admin'&&!SYSTEM_NAMES.includes(p.display_name));if(g.length)grp.push({label:deptBadge(r),items:g});});
    const noRole=match.filter(p=>!p.sales_role&&p.role!=='admin'&&!SYSTEM_NAMES.includes(p.display_name));if(noRole.length)grp.push({label:'<b>⏳ Senza ruolo</b>',items:noRole});
    const sys=match.filter(p=>p.role==='admin'||SYSTEM_NAMES.includes(p.display_name));if(sys.length)grp.push({label:'<b>⚙️ Sistema / Admin</b>',items:sys});
    let h=`<table class="tbl"><thead><tr><th>Persona</th><th>Ruolo / reparto</th><th>Tracciato</th><th>Gestione</th></tr></thead><tbody>`;
    if(!grp.length) h+='<tr><td colspan="4" class="empty">Nessuno trovato.</td></tr>';
    grp.forEach(g=>{ h+=`<tr><td colspan="4" style="background:var(--surface-2);padding:8px 12px">${g.label} <span class="muted" style="font-weight:600">· ${g.items.length}</span></td></tr>`; g.items.forEach(p=>h+=rowHtml(p)); });
    $('#raBody',c).innerHTML=h+'</tbody></table>';
    c.querySelectorAll('.ra-sel').forEach(s=>s.addEventListener('change',async()=>{
      const p=profs.find(x=>x.id===s.dataset.id);
      if(await patch(s.dataset.id,'sales_role',s.value||null,p)) toast(s.value?('Ruolo: '+ROLES[s.value].label):'Ruolo rimosso');
    }));
    c.querySelectorAll('.ra-track').forEach(t=>t.addEventListener('change',async()=>{
      const p=profs.find(x=>x.id===t.dataset.id);
      if(await patch(t.dataset.id,'trackable',t.checked,p)) toast(t.checked?'Ora tracciato':'Escluso dal tracking');
    }));
    c.querySelectorAll('.ra-rm').forEach(b=>b.addEventListener('click',async()=>{
      const p=profs.find(x=>x.id===b.dataset.id);
      if(!confirm('Eliminare DEFINITIVAMENTE '+(p?.display_name||'')+'?\nL\'account e i suoi dati spariscono per sempre. Irreversibile.\n\n(Per nasconderlo dalla dashboard senza eliminarlo, togli "Tracciato".)')) return;
      b.textContent='Elimino…'; b.disabled=true;
      const {data:r,error}=await sb.functions.invoke('team-admin',{body:{action:'delete',id:b.dataset.id}});
      if(error||r?.error){toast('Errore: '+(r?.error||error.message));b.textContent='🗑 Rimuovi';b.disabled=false;return;}
      const i=profs.findIndex(x=>x.id===b.dataset.id); if(i>=0)profs.splice(i,1);
      toast((p?.display_name||'')+' eliminato'); render();
    }));
  }
  render();$('#raSearch',c).addEventListener('input',render);
}

/* ---------- COLLAB: OGGI ---------- */
async function viewToday(c){
  const role=ROLES[S.role];
  c.innerHTML=`<div class="page-head"><div><h1>Oggi · ${role.icon} ${role.label}</h1><p class="sub" id="dateSub"></p></div></div><div id="todayBody"><div class="empty">Carico i tuoi numeri…</div></div>`;
  $('#dateSub',c).textContent = today().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
  const [entry,monthEntries,suggestion] = await Promise.all([myToday(),myEntries(isoDay(monthStart())),mySuggestion()]);
  const cur = entry?.kpis||{};
  const sug = (!entry && suggestion?.kpis) ? suggestion.kpis : {}; // pre-fill solo se non ha già compilato
  const wkStartISO=isoDay(weekStart());
  const monthSum={},weekSum={};
  role.kpis.forEach(k=>{monthSum[k.key]=0;weekSum[k.key]=0;});
  monthEntries.forEach(e=>{role.kpis.forEach(k=>{const v=+(e.kpis?.[k.key]||0);monthSum[k.key]+=v;if(e.day>=wkStartISO)weekSum[k.key]+=v;});});
  const wdM=workdaysElapsedMonth(), wdW=workdaysElapsedWeek();

  const body=$('#todayBody',c); body.innerHTML='';
  // progress cards (north + period)
  const north=role.kpis.find(k=>k.key===role.north)||role.kpis[0];
  const cards=el('div','grid grid-3');
  [['Oggi',+(cur[north.key]||0),north.daily],
   ['Questa settimana',weekSum[north.key]||0,north.daily*wdW],
   ['Questo mese',monthSum[north.key]||0,north.daily*wdM]
  ].forEach(([lbl,val,tgt])=>{
    const pct=tgt>0?val/tgt:0,st=statusOf(pct),gap=Math.max(0,tgt-val);
    const s=el('div','stat');
    s.innerHTML=`<div class="tag ${st}">${statusLabel(st)}</div>
      <div class="lbl">${north.unit==='€'?'💶':'⭐'} ${north.label} · ${lbl}</div>
      <div class="val mono">${fmtv(val,north.unit)}</div>
      <div class="meta">obiettivo ${fmtv(tgt,north.unit)} · ${gap>0?('mancano <b>'+fmtv(gap,north.unit)+'</b>'):'raggiunto ✓'}</div>
      <div class="bar ${st}"><span style="width:${Math.min(100,Math.round(pct*100))}%"></span></div>`;
    cards.appendChild(s);
  });
  body.appendChild(cards);

  // streak di compilazione (premia il rito quotidiano)
  const daySet=new Set(monthEntries.map(e=>e.day));
  let streak=0, probe=new Date(today());
  if(!daySet.has(isoDay(probe))) probe.setDate(probe.getDate()-1); // se oggi non ancora compilato, non spezzare
  for(let i=0;i<62;i++){ if(probe.getDay()===0){probe.setDate(probe.getDate()-1);continue;} if(daySet.has(isoDay(probe))){streak++;probe.setDate(probe.getDate()-1);} else break; }
  if(streak>0){ const sc=el('div','banner good'); sc.style.marginTop='16px';
    sc.innerHTML=`🔥 <b>${streak} giorn${streak===1?'o':'i'} di fila</b> che compili. L'abitudine è metà del risultato — non spezzarla.`;
    body.appendChild(sc); }

  // ritmo ideale (mese)
  const idealPct = wdM/WORKDAYS_MONTH;
  const realPct = (north.daily*WORKDAYS_MONTH)>0 ? (monthSum[north.key]||0)/(north.daily*WORKDAYS_MONTH) : 0;
  const pace = realPct>=idealPct ? 'good':'warn';
  const paceBanner=el('div','banner '+(pace==='good'?'good':'warn'));
  paceBanner.style.marginTop='16px';
  paceBanner.innerHTML = pace==='good'
    ? `🔥 Sei <b>avanti o in pari</b> col ritmo del mese. Stai costruendo il risultato — continua così.`
    : `⚠️ Sei <b>sotto il ritmo ideale</b> del mese. Per rientrare servono ~<b>${fmtv(Math.max(0,(north.daily*wdM)-(monthSum[north.key]||0)),north.unit)}</b> di ${north.label.toLowerCase()} in più, da recuperare nei prossimi giorni.`;
  body.appendChild(paceBanner);

  // 💰 SALDO GIOCO (bonus/malus mese)
  const ebd={}; monthEntries.forEach(e=>ebd[e.day]=e.kpis||{});
  const gs=gameStats(ebd,S.role,monthStart(),today());
  const gcard=el('div','card'); gcard.style.marginTop='16px';
  const gcol = gs.bal>0?'var(--good)':gs.bal<0?'var(--bad)':'var(--ink-2)';
  gcard.innerHTML=`<div class="card-h"><h3>💰 Saldo gioco · mese</h3><span class="muted">bonus/malus, solo per gioco</span></div>
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
      <div style="font-size:34px;font-weight:800;letter-spacing:-.02em;color:${gcol}">${gs.bal>=0?'+':'−'}€${Math.abs(gs.bal).toFixed(2).replace('.',',')}</div>
      <div class="muted" style="font-size:13px">🟢 ${gs.plus} giorni a target · ⚪ ${gs.zero} sotto · 🔴 ${gs.minus} non compilati</div>
    </div>
    <div class="muted" style="font-size:12.5px;margin-top:10px">Regole: <b>+€2</b> se compili e raggiungi l'obiettivo · <b>+€0,50</b> se compili sotto · <b>−€1</b> se non compili. Compilare conviene sempre.</div>`;
  body.appendChild(gcard);

  // form compilazione
  const formCard=el('div','card'); formCard.style.marginTop='16px';
  const hasSug=Object.keys(sug).length>0;
  formCard.innerHTML=`<div class="card-h"><h3>Compila la giornata · 60 secondi</h3></div>`;
  if(hasSug){const sb=el('div','banner info');sb.style.marginBottom='14px';sb.innerHTML=`📥 Alcuni campi sono <b>già pre-compilati dai tuoi dati reali</b> (${suggestion.source||'auto'}). Controlla e salva — correggi solo se serve.`;formCard.appendChild(sb);}
  const inputKpis=role.kpis.filter(k=>k.kind!=='calc');
  const calcKpis=role.kpis.filter(k=>k.kind==='calc');
  const form=el('div','kpi-form');
  inputKpis.forEach(k=>{
    const pre = cur[k.key]!=null ? cur[k.key] : (sug[k.key]!=null?sug[k.key]:'');
    const fromSug = cur[k.key]==null && sug[k.key]!=null;
    const f=el('div','field');
    if(k.unit==='bool'){
      f.innerHTML=`<div class="f-lbl">${k.label}<small>${k.descr||'Sì / No'}</small></div>
        <div class="f-in"><div class="seg ksw" data-k="${k.key}"><button type="button" data-v="1" class="${(+pre)===1?'on':''}">Sì</button><button type="button" data-v="0" class="${pre!==''&&(+pre)===0?'on':''}">No</button></div></div>`;
    } else {
      const sub = fromSug ? '<b style="color:var(--brand)">📥 da '+(suggestion.source||'auto')+'</b>' : (k.descr||('obiettivo: '+fmtv(k.daily,k.unit)));
      f.innerHTML=`<div class="f-lbl">${k.label}<small>${sub}</small></div>
        <div class="f-in"><input id="k_${k.key}" class="kin" data-k="${k.key}" type="number" min="0" inputmode="decimal" value="${pre}" placeholder="0"><span class="unit">${k.unit==='€'?'€':'n'}</span></div>`;
    }
    form.appendChild(f);
  });
  formCard.appendChild(form);
  if(calcKpis.length){
    const cwrap=el('div'); cwrap.style.cssText='display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)';
    calcKpis.forEach(k=>{const box=el('div');box.style.cssText='flex:1;min-width:110px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--surface-2)';
      box.innerHTML=`<div class="muted" style="font-size:10.5px">⚙️ ${k.label} (auto)</div><div class="mono" id="calc_${k.key}" style="font-size:19px;font-weight:800;margin-top:2px">—</div>`;
      cwrap.appendChild(box);});
    formCard.appendChild(cwrap);
  }
  const saveBtn=el('button','btn btn-primary btn-block','💾 Salva la giornata'); saveBtn.style.marginTop='18px';
  const msg=el('div','muted'); msg.style.cssText='text-align:center;margin-top:10px;font-size:13px';
  msg.textContent = entry ? '✓ Giornata già compilata oggi — puoi aggiornarla.' : '';
  formCard.appendChild(saveBtn); formCard.appendChild(msg);
  body.appendChild(formCard);

  // metriche calcolate live (show-up, conversione, ecc.)
  function readVals(){ const v={}; inputKpis.forEach(k=>{ if(k.unit==='bool'){ const on=c.querySelector('.ksw[data-k="'+k.key+'"] .on'); v[k.key]=on?+on.dataset.v:0; } else { v[k.key]=+($('#k_'+k.key,c)?.value||0); } }); return v; }
  function refreshCalc(){ const v=readVals(); calcKpis.forEach(k=>{ const o=$('#calc_'+k.key,c); if(o)o.textContent=fmtCalc(calcKpi(k.formula,v),k.unit); }); }
  c.querySelectorAll('.ksw').forEach(sw=>sw.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{sw.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');refreshCalc();})));
  c.querySelectorAll('.kin').forEach(i=>i.addEventListener('input',refreshCalc));
  refreshCalc();

  saveBtn.addEventListener('click',async()=>{
    const v=readVals(); const kpis={...v};
    calcKpis.forEach(k=>{const cv=calcKpi(k.formula,v); if(cv!=null) kpis[k.key]= k.unit==='%'?Math.round(cv*100):Math.round(cv*100)/100;});
    saveBtn.disabled=true; saveBtn.textContent='Salvo…';
    const {error}=await saveToday(kpis);
    if(error){saveBtn.disabled=false;saveBtn.textContent='💾 Salva la giornata';msg.style.color='var(--bad)';msg.textContent='Errore: '+error.message;return;}
    viewToday(c); // ricarica con i nuovi numeri
  });
}

/* ---------- COLLAB: ANDAMENTO ---------- */
async function viewTrend(c){
  const role=ROLES[S.role];
  c.innerHTML=`<div class="page-head"><div><h1>Andamento · ${role.icon} ${role.label}</h1><p class="sub">Il tuo storico del mese e la proiezione di fine mese.</p></div></div><div id="trendBody"><div class="empty">Carico…</div></div>`;
  const entries=await myEntries(isoDay(monthStart()));
  const body=$('#trendBody',c); body.innerHTML='';
  const north=role.kpis.find(k=>k.key===role.north)||role.kpis[0];
  // serie giornaliera del north per spark
  const byDay={}; entries.forEach(e=>byDay[e.day]=+(e.kpis?.[north.key]||0));
  const days=Object.keys(byDay).sort();
  const monthSum=days.reduce((a,d)=>a+byDay[d],0);
  const wdM=workdaysElapsedMonth();
  const projection = Math.round((monthSum/Math.max(1,wdM))*WORKDAYS_MONTH);
  const monthTarget=north.daily*WORKDAYS_MONTH;

  const top=el('div','grid grid-3');
  top.innerHTML=`
    <div class="stat"><div class="lbl">📅 Giorni compilati</div><div class="val mono">${days.length}</div><div class="meta">su ${wdM} lavorativi del mese</div></div>
    <div class="stat"><div class="lbl">⭐ ${north.label} · mese</div><div class="val mono">${fmtv(monthSum,north.unit)}</div><div class="meta">obiettivo ${fmtv(monthTarget,north.unit)}</div></div>
    <div class="stat"><div class="tag ${statusOf(monthTarget?projection/monthTarget:0)}">${projection>=monthTarget?'sopra':'sotto'}</div><div class="lbl">🔮 Proiezione fine mese</div><div class="val mono">${fmtv(projection,north.unit)}</div><div class="meta">col ritmo di adesso</div></div>`;
  body.appendChild(top);

  // sparkline ultimi giorni
  const sparkCard=el('div','card'); sparkCard.style.marginTop='16px';
  const max=Math.max(1,...days.map(d=>byDay[d]));
  sparkCard.innerHTML=`<div class="card-h"><h3>${north.label} · giorno per giorno</h3></div>
    <div class="spark">${days.map(d=>`<i class="${byDay[d]>=north.daily?'on':''}" style="height:${Math.max(6,Math.round(byDay[d]/max*100))}%" title="${d}: ${fmtv(byDay[d],north.unit)}"></i>`).join('')||'<span class="muted">Nessun dato ancora questo mese.</span>'}</div>`;
  body.appendChild(sparkCard);
}

/* ---------- PIANO VENDITE — LUGLIO 2026 (target 80.000€) · modello certificato 9.8 ---------- */
async function viewMarketingPlan(c){
  // Funnel singolo a 4 fasi: Contatti → Prime chiamate → Presentazioni → Vendite.
  // Dati reali Meta Ads STS (Maggio consuntivo + Giugno parziale). Statico: nessuna dipendenza dati = nessun NaN.
  const TICKET=4900, OBIETTIVO=80000, INCASSO_PCT=0.5, GG_LAV=23;
  const vendite=Math.round(OBIETTIVO/TICKET);
  const incassoSubito=OBIETTIVO*INCASSO_PCT;
  const eur=v=>'€'+nf.format(Math.round(v));

  // 3 scenari — conversioni reali (ogni 100) + fabbisogno per 80k
  const scen=[
    {nome:'Migliore',  tag:'come Maggio',  c2pc:32, pc2p:75, p2v:44, cpl:31, contatti:157, chiamate:50,  pres:37, spesa:4900,  cac:300},
    {nome:'Realistico',tag:'piano operativo',c2pc:31,pc2p:56, p2v:35, cpl:28, contatti:269, chiamate:83,  pres:47, spesa:7583,  cac:464},
    {nome:'Peggiore',  tag:'come Giugno',  c2pc:31, pc2p:52, p2v:22, cpl:28, contatti:469, chiamate:144, pres:75, spesa:12970, cac:795},
  ];
  const R=scen[1]; // realistico = piano che guida la distribuzione

  // distribuzione settimanale luglio (front-load: spingere le prime 2 settimane, ad agosto ferie)
  const wk=[
    {s:'Sett 1', v:5, pres:14, ch:25, cont:81, spesa:2275},
    {s:'Sett 2', v:5, pres:14, ch:25, cont:81, spesa:2275},
    {s:'Sett 3', v:4, pres:12, ch:21, cont:67, spesa:1896},
    {s:'Sett 4', v:2, pres:7,  ch:13, cont:40, spesa:1137},
  ];

  // consuntivo Maggio (dati reali) — il mese in cui 80k è già stato toccato
  const mag=[
    {s:'Sett 1', spesa:950,  cont:8,  ch:5,  pres:3,  v:3},
    {s:'Sett 2', spesa:1257, cont:43, ch:11, pres:7,  v:2},
    {s:'Sett 3', spesa:1455, cont:66, ch:8,  pres:5,  v:0},
    {s:'Sett 4', spesa:1445, cont:46, ch:28, pres:24, v:12},
  ];
  const magTot={spesa:5107, cont:163, ch:52, pres:39, v:17};

  c.innerHTML=`<div class="page-head"><div><h1>📈 Piano Vendite — Luglio 2026</h1><p class="sub">Obiettivo <b>80.000€</b> in un mese · ticket medio 4.900€ → ~16 vendite · si incassa subito il 50% (40.000€) · 23 gg lavorativi. Dal fatturato si ricava il funnel a ritroso. Modello certificato <b>9.8</b> su dati reali Meta Ads.</p></div></div><div id="mkpBody"></div>`;
  const body=$('#mkpBody',c); body.innerHTML='';

  // --- KPI cards riepilogo ---
  const cards=el('div'); cards.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px';
  const kpis=[
    ['🎯 Obiettivo fatturato', eur(OBIETTIVO), 'in 1 mese · Luglio 2026'],
    ['🤝 Vendite necessarie', vendite, 'ticket medio '+eur(TICKET)],
    ['💶 Incassato subito', eur(incassoSubito), '50% alla firma'],
    ['📊 Presentazioni', R.pres, 'piano realistico'],
    ['📞 Prime chiamate', R.chiamate, 'qualifica in target'],
    ['🧲 Contatti (lead)', R.contatti, 'in cima al funnel'],
    ['💸 Spesa ads', eur(R.spesa), 'CPL '+eur(R.cpl)],
    ['🎯 Costo per cliente', eur(R.cac), 'CAC scenario realistico'],
  ];
  cards.innerHTML=kpis.map(k=>`<div class="stat"><div class="lbl">${k[0]}</div><div class="val mono">${k[1]}</div><div class="meta">${k[2]}</div></div>`).join('');
  body.appendChild(cards);

  // --- FUNNEL visivo (scenario realistico) ---
  const fcard=el('div','card'); fcard.style.marginBottom='16px';
  const stages=[
    {n:'Contatti', v:R.contatti, d:'lasciano i dati'},
    {n:'Prime chiamate', v:R.chiamate, d:`qualifica · ${R.c2pc}%`},
    {n:'Presentazioni', v:R.pres, d:`la vendita vera · ${R.pc2p}%`},
    {n:'Vendite', v:vendite, d:`firma+paga · ${R.p2v}%`},
  ];
  fcard.innerHTML=`<div class="card-h"><h3>🛣️ Il funnel a 4 fasi</h3><span class="muted">scenario realistico · ogni fase perde una parte</span></div>
    <div style="display:flex;flex-wrap:wrap;align-items:stretch;gap:8px;margin-top:10px">
    ${stages.map((s,i)=>`<div style="flex:1;min-width:120px;text-align:center;padding:14px 10px;border-radius:12px;background:var(--surface-2);position:relative">
      <div class="mono" style="font-size:26px;font-weight:800;color:var(--brand)">${s.v}</div>
      <div style="font-weight:700;margin-top:2px">${s.n}</div>
      <div class="muted" style="font-size:12px;margin-top:2px">${s.d}</div>
      ${i<stages.length-1?'<div style="position:absolute;right:-13px;top:50%;transform:translateY(-50%);font-size:20px;color:var(--muted);z-index:2">→</div>':''}
    </div>`).join('')}
    </div>`;
  body.appendChild(fcard);

  // --- TABELLA: cosa serve per 80.000€ (3 scenari) ---
  const t1=el('div','card'); t1.style.cssText='padding:0;overflow:auto;margin-bottom:16px';
  t1.innerHTML=`<div class="card-h" style="padding:14px 16px 0"><h3>📐 Cosa serve per 80.000€</h3><span class="muted">tre scenari secondo le conversioni reali</span></div>
  <table class="tbl"><thead><tr><th>In un mese</th>${scen.map(s=>`<th>${s.nome}<br><span class="muted" style="font-weight:400;font-size:11px">${s.tag}</span></th>`).join('')}</tr></thead><tbody>
    <tr><td><b>Contatti</b></td>${scen.map(s=>`<td class="mono">${s.contatti}</td>`).join('')}</tr>
    <tr><td><b>Prime chiamate</b></td>${scen.map(s=>`<td class="mono">${s.chiamate}</td>`).join('')}</tr>
    <tr><td><b>Presentazioni</b></td>${scen.map(s=>`<td class="mono">${s.pres}</td>`).join('')}</tr>
    <tr><td><b>Vendite</b></td>${scen.map(()=>`<td class="mono">${vendite}</td>`).join('')}</tr>
    <tr><td><b>Spesa pubblicità</b></td>${scen.map(s=>`<td class="mono">${eur(s.spesa)}</td>`).join('')}</tr>
    <tr style="font-weight:800;background:var(--surface-2)"><td>Costo per cliente</td>${scen.map(s=>`<td class="mono">${eur(s.cac)}</td>`).join('')}</tr>
  </tbody></table>`;
  body.appendChild(t1);

  // --- TABELLA: conversioni ogni 100 ---
  const t2=el('div','card'); t2.style.cssText='padding:0;overflow:auto;margin-bottom:16px';
  t2.innerHTML=`<div class="card-h" style="padding:14px 16px 0"><h3>📉 Quante avanzano (ogni 100)</h3><span class="muted">il motore che muove tutto il piano</span></div>
  <table class="tbl"><thead><tr><th>Passaggio</th><th>Migliore</th><th>Realistico</th><th>Peggiore</th></tr></thead><tbody>
    <tr><td><b>Contatti → Prime chiamate</b></td><td class="mono">${scen[0].c2pc}%</td><td class="mono">${scen[1].c2pc}%</td><td class="mono">${scen[2].c2pc}%</td></tr>
    <tr><td><b>Prime chiamate → Presentazioni</b></td><td class="mono">${scen[0].pc2p}%</td><td class="mono">${scen[1].pc2p}%</td><td class="mono">${scen[2].pc2p}%</td></tr>
    <tr><td><b>Presentazioni → Vendite</b></td><td class="mono">${scen[0].p2v}%</td><td class="mono">${scen[1].p2v}%</td><td class="mono">${scen[2].p2v}%</td></tr>
    <tr style="font-weight:800;background:var(--surface-2)"><td>Costo per contatto</td><td class="mono">${eur(scen[0].cpl)}</td><td class="mono">${eur(scen[1].cpl)}</td><td class="mono">${eur(scen[2].cpl)}</td></tr>
  </tbody></table>`;
  body.appendChild(t2);

  // --- TABELLA: distribuzione luglio ---
  const t3=el('div','card'); t3.style.cssText='padding:0;overflow:auto;margin-bottom:16px';
  const wkTot=wk.reduce((a,r)=>({v:a.v+r.v,pres:a.pres+r.pres,ch:a.ch+r.ch,cont:a.cont+r.cont,spesa:a.spesa+r.spesa}),{v:0,pres:0,ch:0,cont:0,spesa:0});
  t3.innerHTML=`<div class="card-h" style="padding:14px 16px 0"><h3>🗓️ Distribuzione del lavoro a Luglio</h3><span class="muted">front-load: spingere le prime 2 settimane (ad agosto ferie). I contatti si generano 1-2 sett. prima della vendita.</span></div>
  <table class="tbl"><thead><tr><th>Settimana</th><th>Vendite</th><th>Presentazioni</th><th>Prime chiamate</th><th>Contatti</th><th>Spesa</th></tr></thead><tbody>
    ${wk.map(r=>`<tr><td><b>${r.s}</b></td><td class="mono">${r.v}</td><td class="mono">${r.pres}</td><td class="mono">${r.ch}</td><td class="mono">${r.cont}</td><td class="mono">${eur(r.spesa)}</td></tr>`).join('')}
    <tr style="font-weight:800;background:var(--surface-2)"><td>Totale</td><td class="mono">${wkTot.v}</td><td class="mono">${wkTot.pres}</td><td class="mono">${wkTot.ch}</td><td class="mono">${wkTot.cont}</td><td class="mono">${eur(wkTot.spesa)}</td></tr>
  </tbody></table>`;
  body.appendChild(t3);

  // --- TABELLA: consuntivo Maggio (dati reali) ---
  const t4=el('div','card'); t4.style.cssText='padding:0;overflow:auto;margin-bottom:16px';
  t4.innerHTML=`<div class="card-h" style="padding:14px 16px 0"><h3>📍 Maggio — cosa è successo davvero</h3><span class="muted">consuntivo reale · 17 vendite ≈ 83k già toccato</span></div>
  <table class="tbl"><thead><tr><th>Settimana</th><th>Spesa</th><th>Contatti</th><th>Prime chiamate</th><th>Presentazioni</th><th>Vendite</th></tr></thead><tbody>
    ${mag.map(r=>`<tr><td><b>${r.s}</b></td><td class="mono">${eur(r.spesa)}</td><td class="mono">${r.cont}</td><td class="mono">${r.ch}</td><td class="mono">${r.pres}</td><td class="mono">${r.v}</td></tr>`).join('')}
    <tr style="font-weight:800;background:var(--surface-2)"><td>Totale</td><td class="mono">${eur(magTot.spesa)}</td><td class="mono">${magTot.cont}</td><td class="mono">${magTot.ch}</td><td class="mono">${magTot.pres}</td><td class="mono">${magTot.v}</td></tr>
  </tbody></table>`;
  body.appendChild(t4);

  // --- insight + caveat ---
  const note=el('div','card');
  note.innerHTML=`<div class="card-h"><h3>🧠 Le 3 verità del piano</h3></div>
    <ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">
      <li><b>80k è già stato fatto a Maggio</b> (17 vendite ≈ 83k con 5.107€). Ma il 70% delle chiusure è in 1 sola settimana → il problema è la <b>costanza</b>, non la capacità.</li>
      <li><b>Giugno "0 vendite" è un falso allarme</b>: settimane non compilate + lag del funnel (la vendita arriva 1-2 sett. dopo il contatto). Non si conclude su dati incompleti.</li>
      <li><b>Collo di bottiglia = Presentazioni → Vendite</b> (dal 44% al 22%). È lì che si vince o si perde, non sul budget né sul volume di lead.</li>
    </ul>
    <p class="muted" style="margin-top:12px">⚠️ Numeri certificati 9.8 su dati reali Meta Ads (Mag-Giu 2026). Da ri-validare con Lorenzo a fine Giugno completo. Fonte: <code>STS_Griglia_KPI_v1.xlsx</code> · foglio PIANO LUGLIO 2026.</p>`;
  body.appendChild(note);
}

/* ---------- ADMIN: CABINA DI COMANDO (dashboard, selettore periodo) ---------- */
async function viewAdmin(c,sub){
  const isMgr = sub==='manager';
  const mgrLabel = isMgr && ROLES[S.role] ? ROLES[S.role].label : '';
  if(!S.cabPeriod) S.cabPeriod={mode:'today',from:null,to:null};
  c.innerHTML=`<div class="page-head"><div><h1>${isMgr?('👥 Il mio reparto · '+mgrLabel):'🛰️ Cabina di comando'}</h1><p class="sub">${isMgr?'vista reparto':'vista azienda'} · scegli il periodo</p></div></div>
    <div id="cabCtrl" class="card" style="margin-bottom:14px"></div>
    <div id="adminBody"><div class="empty">Carico i dati del team…</div></div>`;
  const {profiles,entries}=await analyticsData();
  let collaborators=profiles.filter(p=>p.role!=='admin'&&p.sales_role&&p.trackable!==false&&p.active!==false);
  if(isMgr) collaborators=collaborators.filter(p=>p.sales_role===S.role);
  const collabIds=new Set(collaborators.map(p=>p.id));
  function range(){
    const t=today(),iso=isoDay,m=S.cabPeriod.mode;
    if(m==='custom'&&S.cabPeriod.from&&S.cabPeriod.to) return {from:S.cabPeriod.from,to:S.cabPeriod.to,label:'periodo scelto'};
    if(m==='yesterday'){const y=new Date(t);y.setDate(y.getDate()-1);return {from:iso(y),to:iso(y),label:'ieri'};}
    if(m==='week') return {from:iso(weekStart()),to:iso(t),label:'questa settimana'};
    if(m==='month') return {from:iso(monthStart()),to:iso(t),label:'questo mese'};
    return {from:iso(t),to:iso(t),label:'oggi'};
  }
  function wire(){
    const m=S.cabPeriod.mode, seg=(id,l)=>`<button class="${m===id?'on':''}" data-m="${id}">${l}</button>`;
    $('#cabCtrl',c).innerHTML=`<div class="datectl">
      <div class="seg">${seg('today','Oggi')}${seg('yesterday','Ieri')}${seg('week','Settimana')}${seg('month','Mese')}</div>
      <div class="datectl" style="gap:7px"><span class="muted" style="font-size:12.5px">dal</span>
      <input type="date" id="cabFrom" value="${S.cabPeriod.from||''}"><span class="muted" style="font-size:12.5px">al</span>
      <input type="date" id="cabTo" value="${S.cabPeriod.to||''}">
      <button class="anchip${m==='custom'?' on':''}" id="cabApply">Applica</button></div></div>`;
    $('#cabCtrl',c).querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>{S.cabPeriod={mode:b.dataset.m,from:null,to:null};wire();paint();}));
    const ap=$('#cabApply',c);if(ap)ap.addEventListener('click',()=>{const f=$('#cabFrom',c).value,t=$('#cabTo',c).value;if(f&&t){S.cabPeriod={mode:'custom',from:f,to:t};wire();paint();}else toast('Scegli inizio e fine');});
  }
  const copyMsg=t=>{ if(navigator.clipboard) navigator.clipboard.writeText(t).then(()=>toast('Messaggio copiato — incollalo dove vuoi'),()=>toast('Copia non riuscita')); else toast('Copia non disponibile'); };
  function streakOf(pid){ const set=new Set(entries.filter(e=>e.user_id===pid).map(e=>e.day)); let s=0,probe=new Date(today()); if(!set.has(isoDay(probe)))probe.setDate(probe.getDate()-1); for(let i=0;i<40;i++){if(probe.getDay()===0){probe.setDate(probe.getDate()-1);continue;}if(set.has(isoDay(probe))){s++;probe.setDate(probe.getDate()-1);}else break;} return s; }

  function paint(){
    const {from,to,label}=range();
    let wd=0; for(let d=new Date(from+'T00:00:00'),tD=new Date(to+'T00:00:00');d<=tD;d.setDate(d.getDate()+1)){if(d.getDay()!==0)wd++;} wd=Math.max(1,wd);
    const inP=entries.filter(e=>e.day>=from&&e.day<=to&&collabIds.has(e.user_id));
    const byUser={}; inP.forEach(e=>{(byUser[e.user_id]=byUser[e.user_id]||[]).push(e);});
    const people=collaborators.map(p=>{
      const es=byUser[p.id]||[]; const R=ROLES[p.sales_role]; const nk=R&&R.kpis.find(k=>k.key===R.north);
      const northTot=es.reduce((a,e)=>a+ +(e.kpis?.[nk?.key]||0),0);
      const tgt=(nk?+nk.daily:0)*wd; const compiled=es.length>0; const pct=tgt>0?northTot/tgt:0;
      return {p,R,nk,compiled,northTot,tgt,pct,inTarget:compiled&&pct>=1,name:p.display_name||p.id.slice(0,8)};
    });
    const total=collaborators.length;
    const compiledN=people.filter(x=>x.compiled).length;
    const inTargetN=people.filter(x=>x.inTarget).length;
    const missN=total-compiledN, underN=people.filter(x=>x.compiled&&!x.inTarget).length;
    const ranked=people.filter(x=>x.compiled).sort((a,b)=>b.pct-a.pct); const best=ranked[0];
    const roleStat={}; ROLE_ORDER.forEach(r=>roleStat[r]={count:0,inT:0,best:null,bestPct:-1});
    people.forEach(x=>{const r=x.p.sales_role,rs=roleStat[r];if(!rs)return;rs.count++;if(x.inTarget)rs.inT++;if(x.compiled&&x.pct>rs.bestPct){rs.bestPct=x.pct;rs.best=x.name;}});
    const activeRoles=ROLE_ORDER.filter(r=>roleStat[r].count>0);
    const bestRole=activeRoles.slice().sort((a,b)=>(roleStat[b].inT/roleStat[b].count)-(roleStat[a].inT/roleStat[a].count))[0];
    let maxStreak=0,maxStreakName='—'; collaborators.forEach(p=>{const s=streakOf(p.id);if(s>maxStreak){maxStreak=s;maxStreakName=p.display_name||'';}});

    const body=$('#adminBody',c); body.innerHTML='';
    if(compiledN===0) body.appendChild(Object.assign(el('div','banner warn'),{innerHTML:`⚠️ <b>Nessuno ha ancora compilato</b> (${label}). Appena il team inizia, qui si riempie tutto.`,style:'margin-bottom:14px'}));
    const compPct=total?Math.round(compiledN/total*100):0;
    const g1=el('div','grid grid-4');
    g1.innerHTML=`
      <div class="stat"><div class="tag ${statusOf(compPct/100)}">${compPct}%</div><div class="lbl">✅ Hanno compilato</div><div class="val mono">${compiledN}/${total}</div><div class="meta">${label}</div></div>
      <div class="stat"><div class="lbl">🎯 Target raggiunto</div><div class="val mono" style="color:var(--good)">${inTargetN}</div><div class="meta">obiettivo centrato</div></div>
      <div class="stat"><div class="lbl">⏰ Da sollecitare</div><div class="val mono" style="color:${missN+underN?'var(--bad)':'var(--ink)'}">${missN+underN}</div><div class="meta">${missN} non compila · ${underN} sotto</div></div>
      <div class="stat"><div class="lbl">📅 Giorni lavorativi</div><div class="val mono">${wd}</div><div class="meta">nel periodo</div></div>`;
    body.appendChild(g1);
    const g2=el('div','grid grid-4'); g2.style.marginTop='14px';
    g2.innerHTML=`
      <div class="stat"><div class="lbl">🏆 Miglior performer</div><div class="val mono" style="font-size:18px">${best?best.name:'—'}</div><div class="meta">${best?Math.round(best.pct*100)+'% del target':'nessun dato'}</div></div>
      <div class="stat"><div class="lbl">🥇 Reparto migliore</div><div class="val mono" style="font-size:18px">${bestRole?ROLES[bestRole].label:'—'}</div><div class="meta">${bestRole?roleStat[bestRole].inT+'/'+roleStat[bestRole].count+' in target':'—'}</div></div>
      <div class="stat"><div class="lbl">🔥 Streak più lunga</div><div class="val mono">${maxStreak} gg</div><div class="meta">${maxStreakName}</div></div>
      <div class="stat"><div class="lbl">📊 Team in target</div><div class="val mono">${total?Math.round(inTargetN/total*100):0}%</div><div class="meta">della squadra</div></div>`;
    body.appendChild(g2);

    // 💼 metriche business team (somma su tutti i reparti, dalle metriche reali)
    let cash=0,fiss=0,pres=0,vinti=0;
    inP.forEach(e=>{const k=e.kpis||{};cash+=+(k.cash_collected||0);fiss+=+(k.appuntamenti_fissati||0);pres+=+(k.appuntamenti_processati||0);vinti+=+(k.vinti||0);});
    const showUp=fiss?Math.round(pres/fiss*100):null, conv=pres?Math.round(vinti/pres*100):null;
    const g3=el('div','grid grid-4'); g3.style.marginTop='14px';
    g3.innerHTML=`
      <div class="stat"><div class="lbl">💶 Cash raccolto</div><div class="val mono">€${nf.format(cash)}</div><div class="meta">${label}</div></div>
      <div class="stat"><div class="lbl">📅 Appuntamenti fissati</div><div class="val mono">${fiss}</div><div class="meta">setter + full stack</div></div>
      <div class="stat"><div class="lbl">🎬 Presentati</div><div class="val mono">${pres}</div><div class="meta">tasso presenza ${showUp!=null?showUp+'%':'—'}</div></div>
      <div class="stat"><div class="lbl">📈 Conversione</div><div class="val mono">${conv!=null?conv+'%':'—'}</div><div class="meta">vinti / presentati</div></div>`;
    body.appendChild(g3);

    // 🍩 grafico a torta — stato squadra
    const a=inTargetN,b=underN,dd=missN,tot=Math.max(1,a+b+dd);
    const d1=(a/tot*360),d2=((a+b)/tot*360);
    const donut=el('div','card'); donut.style.marginTop='16px';
    donut.innerHTML=`<div class="card-h"><h3>Stato squadra</h3><span class="muted">${label}</span></div>
      <div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap">
        <div style="width:148px;height:148px;border-radius:50%;flex-shrink:0;background:conic-gradient(var(--good) 0 ${d1}deg, var(--warn) ${d1}deg ${d2}deg, var(--bad) ${d2}deg 360deg);position:relative">
          <div style="position:absolute;inset:19px;background:var(--surface);border-radius:50%;display:grid;place-items:center;text-align:center"><div><div style="font-size:25px;font-weight:800">${Math.round(a/tot*100)}%</div><div class="muted" style="font-size:11px">in target</div></div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:9px;font-size:13.5px">
          <div><span class="dotk g"></span> In target: <b>${a}</b></div>
          <div><span class="dotk w"></span> Sotto target: <b>${b}</b></div>
          <div><span class="dotk b"></span> Non compilato: <b>${dd}</b></div>
        </div></div>`;
    body.appendChild(donut);

    // 🏆 CLASSIFICA top performer
    const lbCard=el('div','card'); lbCard.style.marginTop='16px';
    lbCard.innerHTML=`<div class="card-h"><h3>🏆 Classifica</h3><span class="muted">${label} · top performer</span></div>`;
    if(ranked.length){
      const medals=['🥇','🥈','🥉'], mx=ranked[0].pct||1;
      lbCard.insertAdjacentHTML('beforeend',ranked.slice(0,10).map((x,i)=>{
        const w=Math.max(3,Math.min(100,x.pct/mx*100)),col=x.pct>=1?'var(--good)':x.pct>=0.6?'var(--warn)':'var(--bad)';
        return `<div style="display:flex;align-items:center;gap:11px;margin-bottom:9px">
          <div style="width:24px;text-align:center;font-weight:800">${medals[i]||(i+1)}</div>
          <div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><b>${x.name}</b><span class="muted">${Math.round(x.pct*100)}%</span></div><div style="background:var(--line);border-radius:6px;height:10px;overflow:hidden"><span style="display:block;height:100%;width:${w}%;background:${col}"></span></div></div>
          <div style="flex-shrink:0">${deptBadge(x.p.sales_role)}</div></div>`;
      }).join(''));
    } else lbCard.insertAdjacentHTML('beforeend','<div class="empty">Nessuna compilazione nel periodo.</div>');
    body.appendChild(lbCard);

    const repCard=el('div','card'); repCard.style.marginTop='16px';
    repCard.innerHTML=`<div class="card-h"><h3>Performance per reparto</h3><span class="muted">${label}</span></div>`;
    if(activeRoles.length){
      const grid=el('div','grid grid-3');
      activeRoles.forEach(r=>{const rs=roleStat[r],pct=rs.count?Math.round(rs.inT/rs.count*100):0;
        const card=el('div'); card.style.cssText='border:1px solid var(--line);border-radius:12px;padding:14px';
        card.innerHTML=`<div style="margin-bottom:10px">${deptBadge(r)}</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
            <div><div class="muted" style="font-size:11px">Persone</div><b>${rs.count}</b></div>
            <div><div class="muted" style="font-size:11px">In target</div><b style="color:var(--good)">${rs.inT}</b></div>
            <div><div class="muted" style="font-size:11px">Da sollecitare</div><b style="color:${rs.count-rs.inT?'var(--bad)':'var(--ink)'}">${rs.count-rs.inT}</b></div></div>
          <div class="bar ${pct>=60?'good':pct>=30?'warn':'bad'}" style="margin-top:12px"><span style="width:${pct}%"></span></div>
          <div class="muted" style="font-size:11.5px;margin-top:7px">${pct}% in target${rs.best?' · 🏆 '+rs.best:''}</div>`;
        grid.appendChild(card);
      });
      repCard.appendChild(grid);
    } else repCard.appendChild(el('div','empty','Nessun dato nel periodo.'));
    body.appendChild(repCard);

    // 🎁 PREMI & STREAK (mensile, soglia configurabile)
    const BONUS_DAYS=15, monthFrom=isoDay(monthStart());
    const premi=collaborators.map(p=>{
      const R=ROLES[p.sales_role],nk=R&&R.kpis.find(k=>k.key===R.north),dt=nk?+nk.daily:0;
      const es=entries.filter(e=>e.user_id===p.id&&e.day>=monthFrom);
      const daysInT=es.filter(e=>dt>0&&+(e.kpis?.[nk.key]||0)>=dt).length;
      return {name:p.display_name||'',role:p.sales_role,daysInT,streak:streakOf(p.id),matured:daysInT>=BONUS_DAYS};
    }).filter(x=>x.streak>0||x.daysInT>0).sort((a,b)=>b.daysInT-a.daysInT||b.streak-a.streak);
    const prCard=el('div','card'); prCard.style.marginTop='16px';
    prCard.innerHTML=`<div class="card-h"><h3>🎁 Premi & Streak</h3><span class="muted">premio al raggiungimento di ${BONUS_DAYS} giorni in target / mese</span></div>`;
    if(premi.length){
      prCard.insertAdjacentHTML('beforeend',premi.slice(0,10).map(x=>{
        const pct=Math.min(100,Math.round(x.daysInT/BONUS_DAYS*100));
        return `<div style="display:flex;align-items:center;gap:11px;margin-bottom:9px">
          <div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><b>${x.name}</b><span>${x.matured?'<b style="color:var(--good)">🎉 premio maturato</b>':'🔥 '+x.streak+'gg streak'}</span></div><div style="background:var(--line);border-radius:6px;height:10px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:${x.matured?'var(--good)':'var(--warn)'}"></span></div><div class="muted" style="font-size:11px;margin-top:3px">${x.daysInT}/${BONUS_DAYS} giorni in target questo mese</div></div>
          <div style="flex-shrink:0">${deptBadge(x.role)}</div></div>`;
      }).join(''));
    } else prCard.insertAdjacentHTML('beforeend','<div class="empty">Ancora nessuna streak — parte appena il team compila.</div>');
    body.appendChild(prCard);

    const sollList=people.filter(x=>!x.compiled||!x.inTarget).sort((a,b)=>a.pct-b.pct);
    const congrList=people.filter(x=>x.inTarget).sort((a,b)=>b.pct-a.pct);
    const personRow=(x,btnLabel,onClick)=>{
      const row=el('div'); row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 11px;border:1px solid var(--line);border-radius:10px';
      row.innerHTML=`<div style="min-width:0"><b style="font-size:13.5px">${x.name}</b> ${deptBadge(x.p.sales_role)}</div>`;
      const r2=el('div'); r2.style.cssText='display:flex;align-items:center;gap:10px;flex-shrink:0';
      r2.innerHTML=`<span class="muted" style="font-size:11.5px">${x.compiled?Math.round(x.pct*100)+'%':'non compila'}</span>`;
      const btn=el('button','btn btn-ghost',btnLabel); btn.style.cssText='padding:6px 11px;font-size:12px'; btn.addEventListener('click',onClick);
      r2.appendChild(btn); row.appendChild(r2); return row;
    };
    const actGrid=el('div','grid grid-2'); actGrid.style.marginTop='16px';
    const sc=el('div','card'); sc.innerHTML=`<div class="card-h"><h3>⏰ Da sollecitare</h3><span class="muted">${sollList.length}</span></div>`;
    const sw=el('div','alert-wrap');
    if(sollList.length) sollList.forEach(x=>sw.appendChild(personRow(x,'✉️ Sollecita',()=>copyMsg(`Ciao ${x.name}, oggi non risulti ancora in target. Dai priorità alle attività principali e aggiorna la dashboard appena possibile. Teniamo il ritmo della squadra. 💪`))));
    else sw.appendChild(el('div','banner good','✅ Nessuno da sollecitare.'));
    sc.appendChild(sw); actGrid.appendChild(sc);
    const cc=el('div','card'); cc.innerHTML=`<div class="card-h"><h3>🎯 In target</h3><span class="muted">${congrList.length}</span></div>`;
    const cw=el('div','alert-wrap');
    if(congrList.length) congrList.forEach(x=>cw.appendChild(personRow(x,'🎉 Complimenti',()=>copyMsg(`Grande ${x.name}, oggi hai raggiunto il target! Continua così: costanza, disciplina e numeri chiari fanno crescere tutta la squadra. 🚀`))));
    else cw.appendChild(el('div','banner info','Ancora nessuno in target nel periodo.'));
    cc.appendChild(cw); actGrid.appendChild(cc);
    body.appendChild(actGrid);

    if(!isMgr){ const note=el('div','banner info'); note.style.marginTop='16px'; note.innerHTML='ℹ️ I bottoni <b>Sollecita</b>/<b>Complimenti</b> copiano un messaggio pronto da incollare (Slack/WhatsApp). I target si impostano in <b>🎯 Obiettivi</b>.'; body.appendChild(note); }
  }
  wire(); paint();
}

/* ---------- ADMIN: KPI-BUILDER (reparti/KPI configurabili senza codice) ---------- */
function slugKey(s){return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,28)||('kpi'+Math.floor(Math.random()*1e4));}
async function viewKpiBuilder(c){
  c.innerHTML=`<div class="page-head"><div><h1>⚙️ KPI & Reparti</h1><p class="sub">Aggiungi reparti, KPI e obiettivi senza toccare codice. Le modifiche sono subito live per il team.</p></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>➕ Nuovo reparto</h3></div>
      <div class="kpi-form" style="grid-template-columns:1fr 1fr">
        <div class="field"><div class="f-lbl">Nome reparto</div><div class="f-in"><input id="ndLabel" placeholder="es. Copywriting"></div></div>
        <div class="field"><div class="f-lbl">Emoji</div><div class="f-in"><input id="ndIcon" placeholder="✍️" maxlength="3" value="•"></div></div>
        <div class="field"><div class="f-lbl">Primo KPI</div><div class="f-in"><input id="ndKpi" placeholder="es. Testi scritti"></div></div>
        <div class="field"><div class="f-lbl">Obiettivo/die</div><div class="f-in"><input id="ndDaily" type="number" min="0" value="1"><span class="unit">n</span></div></div>
      </div>
      <button class="btn btn-primary" id="ndAdd" style="margin-top:8px">Crea reparto</button> <span class="muted" id="ndMsg"></span></div>
    <div id="kbBody"><div class="empty">Carico il catalogo…</div></div>`;
  let cat=[];
  async function reload(){const{data}=await sb.from('kpi_catalog').select('*').order('role_sort').order('sort');cat=data||[];await loadCatalog();render();}
  async function mut(promise,okMsg){const{error}=await promise;if(error){toast('Errore: '+error.message);return false;}if(okMsg)toast(okMsg);return true;}

  function render(){
    const byRole={};cat.forEach(r=>{(byRole[r.role]=byRole[r.role]||[]).push(r);});
    const body=$('#kbBody',c);body.innerHTML='';
    Object.keys(byRole).forEach(role=>{
      const rows=byRole[role];const meta=rows[0];
      const card=el('div','card');card.style.marginBottom='16px';
      card.innerHTML=`<div class="card-h"><h3>${meta.role_icon||'•'} ${meta.role_label}</h3><span class="muted">${role} · ${rows.length} KPI</span></div>`;
      const tbl=el('table','tbl');
      tbl.innerHTML=`<thead><tr><th>KPI</th><th>Unità</th><th>Obiettivo/die</th><th title="Il KPI principale del reparto: quello su cui si misura se è sotto o sopra ritmo">⭐ Guida</th><th>Attivo</th><th></th></tr></thead><tbody>${
        rows.map(k=>`<tr data-k="${k.kpi_key}">
          <td><input class="kb-lbl" value="${(k.label||'').replace(/"/g,'&quot;')}" style="border:1px solid var(--line);border-radius:8px;padding:6px 9px;width:100%;min-width:140px;font-weight:600"></td>
          <td><select class="kb-unit" style="border:1px solid var(--line);border-radius:8px;padding:6px">${['n','€','%'].map(u=>`<option ${k.unit===u?'selected':''}>${u}</option>`).join('')}</select></td>
          <td><input class="kb-daily" type="number" min="0" value="${+k.daily||0}" style="border:1px solid var(--line);border-radius:8px;padding:6px 9px;width:90px"></td>
          <td style="text-align:center"><input type="radio" name="north_${role}" class="kb-north" ${k.is_north?'checked':''}></td>
          <td style="text-align:center"><input type="checkbox" class="kb-active" ${k.active?'checked':''}></td>
          <td><button class="kb-del" title="Elimina" style="background:none;border:none;cursor:pointer;font-size:16px">🗑</button></td>
        </tr>`).join('')
      }</tbody>`;
      card.appendChild(tbl);
      const add=el('div');add.style.cssText='display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap';
      add.innerHTML=`<input class="kb-newlbl" placeholder="Nuovo KPI…" style="border:1px solid var(--line);border-radius:9px;padding:8px 11px;flex:1;min-width:160px">
        <input class="kb-newdaily" type="number" min="0" value="1" style="border:1px solid var(--line);border-radius:9px;padding:8px;width:80px">
        <button class="btn btn-ghost kb-addkpi">➕ Aggiungi KPI</button>`;
      card.appendChild(add);
      body.appendChild(card);

      // handlers per riga
      card.querySelectorAll('tr[data-k]').forEach(tr=>{
        const kk=tr.dataset.k;
        const save=(patch,msg)=>mut(sb.from('kpi_catalog').update(patch).eq('role',role).eq('kpi_key',kk),msg).then(ok=>{if(ok)reload();});
        tr.querySelector('.kb-lbl').addEventListener('change',e=>save({label:e.target.value.trim()||'KPI'},'Etichetta salvata'));
        tr.querySelector('.kb-unit').addEventListener('change',e=>save({unit:e.target.value},'Unità salvata'));
        tr.querySelector('.kb-daily').addEventListener('change',e=>save({daily:+e.target.value||0},'Obiettivo salvato'));
        tr.querySelector('.kb-active').addEventListener('change',e=>save({active:e.target.checked},e.target.checked?'Attivo':'Disattivato'));
        tr.querySelector('.kb-north').addEventListener('change',async()=>{
          await sb.from('kpi_catalog').update({is_north:false}).eq('role',role);
          await mut(sb.from('kpi_catalog').update({is_north:true}).eq('role',role).eq('kpi_key',kk),'Stella polare aggiornata');reload();
        });
        tr.querySelector('.kb-del').addEventListener('click',async()=>{
          if(!confirm('Eliminare questo KPI? I dati storici restano ma non sarà più compilabile.'))return;
          if(await mut(sb.from('kpi_catalog').delete().eq('role',role).eq('kpi_key',kk),'KPI eliminato'))reload();
        });
      });
      // aggiungi KPI
      card.querySelector('.kb-addkpi').addEventListener('click',async()=>{
        const lbl=card.querySelector('.kb-newlbl').value.trim();if(!lbl){toast('Scrivi il nome del KPI');return;}
        let key=slugKey(lbl);if(rows.some(r=>r.kpi_key===key))key+='_'+Math.floor(Math.random()*99);
        const daily=+card.querySelector('.kb-newdaily').value||0;
        const row={role,kpi_key:key,dept:meta.dept,role_label:meta.role_label,role_icon:meta.role_icon,role_sort:meta.role_sort,label:lbl,unit:'n',daily,is_north:false,sort:(Math.max(0,...rows.map(r=>r.sort||0))+1),active:true,source:'ui'};
        if(await mut(sb.from('kpi_catalog').insert(row),'KPI aggiunto'))reload();
      });
    });
  }
  $('#ndAdd',c).addEventListener('click',async()=>{
    const lbl=$('#ndLabel',c).value.trim(),kpi=$('#ndKpi',c).value.trim();
    if(!lbl||!kpi){$('#ndMsg',c).textContent='Servono nome reparto e primo KPI.';return;}
    const role=slugKey(lbl);
    if(cat.some(r=>r.role===role)){$('#ndMsg',c).textContent='Esiste già un reparto con questo nome.';return;}
    const maxSort=Math.max(0,...cat.map(r=>r.role_sort||0));
    const row={role,kpi_key:slugKey(kpi),dept:lbl,role_label:lbl,role_icon:$('#ndIcon',c).value.trim()||'•',role_sort:maxSort+10,label:kpi,unit:'n',daily:+$('#ndDaily',c).value||0,is_north:true,sort:1,active:true,source:'ui'};
    if(await mut(sb.from('kpi_catalog').insert(row),'Reparto creato')){$('#ndLabel',c).value='';$('#ndKpi',c).value='';reload();}
  });
  reload();
}

/* ---------- ADMIN/MANAGER: ANALISI (grafici + selettore periodo) ---------- */
async function viewAnalytics(c,scope){
  const isMgr=scope==='manager';
  if(!S.period) S.period={mode:'today',from:null,to:null};
  c.innerHTML=`<div class="page-head"><div><h1>📊 Analisi${isMgr&&ROLES[S.role]?' · '+ROLES[S.role].label:''}</h1><p class="sub">Chi lavora di più, giorni più produttivi e andamento. Scegli il periodo.</p></div></div>
    <div id="anCtrl" class="card" style="margin-bottom:16px"></div>
    <div id="anBody"><div class="empty">Carico lo storico…</div></div>`;
  const {profiles,entries}=await analyticsData();
  let collaborators=profiles.filter(p=>p.role!=='admin'&&p.sales_role&&p.trackable!==false&&p.active!==false);
  if(isMgr) collaborators=collaborators.filter(p=>p.sales_role===S.role);
  const collabIds=new Set(collaborators.map(p=>p.id));
  const wdNames=['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
  const hbar=(label,sub,pct,color)=>`<div style="margin-bottom:11px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><b>${label}</b><span class="muted">${sub}</span></div><div style="background:var(--line);border-radius:6px;height:13px;overflow:hidden"><span style="display:block;height:100%;width:${Math.max(2,Math.min(100,pct))}%;background:${color};transition:width .3s"></span></div></div>`;

  function range(){
    const t=today(),iso=isoDay,m=S.period.mode;
    if(m==='custom'&&S.period.from&&S.period.to) return {from:S.period.from,to:S.period.to,label:'periodo scelto'};
    if(m==='today') return {from:iso(t),to:iso(t),label:'oggi'};
    if(m==='yesterday'){const y=new Date(t);y.setDate(y.getDate()-1);return {from:iso(y),to:iso(y),label:'ieri'};}
    if(m==='week') return {from:iso(weekStart()),to:iso(t),label:'questa settimana'};
    if(m==='month') return {from:iso(monthStart()),to:iso(t),label:'questo mese'};
    const n=+m||30,f=new Date(t);f.setDate(f.getDate()-(n-1));
    return {from:iso(f),to:iso(t),label:'ultimi '+n+' giorni'};
  }
  function wire(){
    const m=S.period.mode;
    const seg=(id,lbl)=>`<button class="${m===id?'on':''}" data-m="${id}">${lbl}</button>`;
    $('#anCtrl',c).innerHTML=`<div class="datectl">
      <div class="seg">${seg('today','Oggi')}${seg('yesterday','Ieri')}${seg('week','Settimana')}${seg('month','Mese')}${seg('30','30g')}${seg('90','90g')}</div>
      <div class="datectl" style="gap:7px"><span class="muted" style="font-size:12.5px">dal</span>
      <input type="date" id="anFrom" value="${S.period.from||''}">
      <span class="muted" style="font-size:12.5px">al</span>
      <input type="date" id="anTo" value="${S.period.to||''}">
      <button class="anchip${m==='custom'?' on':''}" id="anApply">Applica</button></div></div>`;
    $('#anCtrl',c).querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>{S.period={mode:b.dataset.m,from:null,to:null};wire();paint();}));
    const ap=$('#anApply',c);if(ap)ap.addEventListener('click',()=>{const f=$('#anFrom',c).value,t=$('#anTo',c).value;if(f&&t){S.period={mode:'custom',from:f,to:t};wire();paint();}else toast('Scegli data inizio e fine');});
  }
  function paint(){
    const {from,to,label}=range();
    const ents=entries.filter(e=>e.day>=from&&e.day<=to&&collabIds.has(e.user_id));
    const per={},ebdU={};collaborators.forEach(p=>{per[p.id]={days:new Set(),perf:0,pn:0,vol:0};ebdU[p.id]={};});
    ents.forEach(e=>{const p=per[e.user_id];if(!p)return;ebdU[e.user_id][e.day]=e.kpis||{};const R=ROLES[e.role];if(!R)return;const nk=R.kpis.find(k=>k.key===R.north);if(!nk)return;const v=+(e.kpis?.[nk.key]||0);p.days.add(e.day);p.vol+=v;if(nk.daily>0){p.perf+=Math.min(2,v/nk.daily);p.pn++;}});
    const fromD=new Date(from+'T00:00:00'),toD=new Date(to+'T00:00:00');
    const rank=collaborators.map(p=>({p,days:per[p.id].days.size,perf:per[p.id].pn?per[p.id].perf/per[p.id].pn:0,euro:gameStats(ebdU[p.id],p.sales_role,fromD,toD).bal})).filter(r=>r.days>0).sort((a,b)=>b.days-a.days||b.perf-a.perf);
    const montePremi=rank.reduce((a,r)=>a+Math.max(0,r.euro),0);
    const wd=wdNames.map(()=>({ents:0,perf:0,pn:0}));const wdMap={1:0,2:1,3:2,4:3,5:4,6:5,0:6};
    ents.forEach(e=>{const d=new Date(e.day+'T00:00:00'),slot=wd[wdMap[d.getDay()]];slot.ents++;const R=ROLES[e.role],nk=R&&R.kpis.find(k=>k.key===R.north);if(nk&&nk.daily>0){slot.perf+=Math.min(2,(+(e.kpis?.[nk.key]||0))/nk.daily);slot.pn++;}});
    const dayMap={};ents.forEach(e=>dayMap[e.day]=(dayMap[e.day]||0)+1);const dayKeys=Object.keys(dayMap).sort();
    const roleCount={};ents.forEach(e=>roleCount[e.role]=(roleCount[e.role]||0)+1);
    const totalComp=ents.length,bestWdIdx=wd.reduce((bi,s,i,a)=>s.ents>a[bi].ents?i:bi,0);
    const body=$('#anBody',c);body.innerHTML='';

    const sum=el('div','grid grid-4');
    sum.innerHTML=`
      <div class="stat"><div class="lbl">📝 Compilazioni</div><div class="val mono">${totalComp}</div><div class="meta">${label}</div></div>
      <div class="stat"><div class="lbl">👥 Persone attive</div><div class="val mono">${rank.length}</div><div class="meta">hanno compilato</div></div>
      <div class="stat"><div class="lbl">🏆 Più costante</div><div class="val mono" style="font-size:19px">${rank[0]?(rank[0].p.display_name||'—'):'—'}</div><div class="meta">${rank[0]?rank[0].days+' giorni':'nessun dato'}</div></div>
      <div class="stat"><div class="lbl">📅 Giorno top</div><div class="val mono" style="font-size:19px">${totalComp?wdNames[bestWdIdx]:'—'}</div><div class="meta">${totalComp?wd[bestWdIdx].ents+' compilazioni':'—'}</div></div>`;
    body.appendChild(sum);

    const rc=el('div','card');rc.style.marginTop='16px';
    rc.innerHTML=`<div class="card-h"><h3>🏅 Chi lavora di più</h3><span class="muted">💰 monte premi €${montePremi.toFixed(2).replace('.',',')}</span></div>`;
    if(rank.length){const maxDays=rank[0].days;
      rc.insertAdjacentHTML('beforeend',rank.map(r=>{const col=r.perf>=1?'var(--good)':r.perf>=0.6?'var(--warn)':'var(--bad)';const ec=r.euro<0?'var(--bad)':'var(--good)';return hbar(`${ROLES[r.p.sales_role]?.icon||''} ${r.p.display_name||'—'}`,`${r.days} gg · ${Math.round(r.perf*100)}% · <b style="color:${ec}">${r.euro>=0?'+':'−'}€${Math.abs(r.euro).toFixed(2).replace('.',',')}</b>`,maxDays?r.days/maxDays*100:0,col);}).join(''));
    } else rc.insertAdjacentHTML('beforeend','<div class="empty">Nessuna compilazione nel periodo.</div>');
    body.appendChild(rc);

    const wc=el('div','card');wc.style.marginTop='16px';
    wc.innerHTML=`<div class="card-h"><h3>📆 Produttività per giorno</h3><span class="muted">quando il team lavora davvero</span></div>`;
    const maxWd=Math.max(1,...wd.map(s=>s.ents));
    wc.insertAdjacentHTML('beforeend',`<div style="display:flex;align-items:flex-end;gap:10px;height:150px;padding-top:10px">${wd.map((s,i)=>{const h=Math.round(s.ents/maxWd*100),avg=s.pn?Math.round(s.perf/s.pn*100):0,col=i===bestWdIdx&&totalComp?'var(--good)':'#3b82f6';return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">${s.ents||''}</div><div title="${avg}% ritmo medio" style="width:100%;background:${col};border-radius:6px 6px 0 0;height:${Math.max(2,h)}%"></div><div style="font-size:12px;margin-top:6px;font-weight:600">${wdNames[i]}</div></div>`;}).join('')}</div>`);
    body.appendChild(wc);

    const dc=el('div','card');dc.style.marginTop='16px';
    dc.innerHTML=`<div class="card-h"><h3>📈 Andamento compilazioni</h3><span class="muted">giorno per giorno</span></div>`;
    if(dayKeys.length){const maxd=Math.max(1,...dayKeys.map(k=>dayMap[k]));
      dc.insertAdjacentHTML('beforeend',`<div class="spark" style="height:90px">${dayKeys.map(k=>`<i style="height:${Math.max(6,Math.round(dayMap[k]/maxd*100))}%" title="${k}: ${dayMap[k]} compilazioni"></i>`).join('')}</div>`);
    } else dc.insertAdjacentHTML('beforeend','<div class="empty">Nessun dato nel periodo.</div>');
    body.appendChild(dc);

    const pc=el('div','card');pc.style.marginTop='16px';
    pc.innerHTML=`<div class="card-h"><h3>🏢 Distribuzione per reparto</h3></div>`;
    const roles=Object.keys(roleCount).sort((a,b)=>roleCount[b]-roleCount[a]);
    if(roles.length){const maxr=Math.max(...roles.map(r=>roleCount[r]));
      pc.insertAdjacentHTML('beforeend',roles.map(r=>hbar(`${ROLES[r]?.icon||''} ${ROLES[r]?.label||r}`,`${roleCount[r]} compilazioni`,roleCount[r]/maxr*100,'#3b82f6')).join(''));
    } else pc.insertAdjacentHTML('beforeend','<div class="empty">Nessun dato.</div>');
    body.appendChild(pc);
  }
  wire();paint();
}

/* ---------- GO ---------- */
boot();
