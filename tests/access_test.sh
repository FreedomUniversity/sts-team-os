#!/bin/zsh
# ============================================================
# STS Performance OS — test accesso/RLS end-to-end (os_entries/os_targets)
# Verifica che l'isolamento dati sia VERO lato server (non solo UI).
# Idempotente: assegna ruolo di test, scrive, verifica, pulisce.
#
# ⚠️  RICHIEDE UN TEST-USER STS REALE: imposta COLLAB_EMAIL / PW / TID sotto
#     con un collaboratore di prova del progetto STS prima di eseguire
#     (i valori sono PLACEHOLDER, non eseguire finché non li sostituisci).
#     Per un test RLS senza credenziali usa: ./tests/marketing_rls_test.sh
# ============================================================
set -e
REF=sbghltmjgllhsgioudlv                          # progetto Supabase STS (corretto, era ref FU)
BASE="https://$REF.supabase.co"
ANON=$(grep -o "SUPABASE_ANON *= *'[^']*'" "$(dirname "$0")/../app.js" | head -1 | sed "s/.*'\(.*\)'/\1/")
ADMIN_EMAIL="infoclaudiocavalli@gmail.com"        # admin STS
COLLAB_EMAIL="PLACEHOLDER@salesteamsolutions.info"  # ⚠️ metti un collaboratore di test STS
PW="PLACEHOLDER_PW"                               # ⚠️ password del test-user STS
TID="PLACEHOLDER_UUID"                            # ⚠️ uuid (profiles.id) del test-user STS
TODAY=$(date +%F)
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
ko(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

jwt(){ curl -s -X POST "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$PW\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))"; }
AJWT=$(jwt "$ADMIN_EMAIL"); CJWT=$(jwt "$COLLAB_EMAIL")
[ -n "$AJWT" ] && ok "login admin" || ko "login admin"
[ -n "$CJWT" ] && ok "login collaboratore" || ko "login collaboratore"

echo "— setup: admin assegna ruolo closer al test user —"
curl -s -X PATCH "$BASE/rest/v1/profiles?id=eq.$TID" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -d '{"sales_role":"closer"}' >/dev/null

echo "— os_entries —"
curl -s -X POST "$BASE/rest/v1/os_entries" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "{\"user_id\":\"$TID\",\"role\":\"closer\",\"day\":\"$TODAY\",\"kpis\":{\"call\":5,\"vendite\":1,\"cash\":3000}}" >/dev/null
SV=$(curl -s "$BASE/rest/v1/os_entries?day=eq.$TODAY&select=kpis" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(d[0]['kpis'].get('cash',-1)) if d else -1)")
[ "$SV" = "3000" ] && ok "collaboratore salva la propria giornata (cash=3000)" || ko "salvataggio giornata ($SV)"
N=$(curl -s "$BASE/rest/v1/os_entries?select=user_id" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print('only' if all(x['user_id']=='$TID' for x in d) else 'leak')")
[ "$N" = "only" ] && ok "collaboratore vede SOLO le proprie entries" || ko "ISOLAMENTO entries violato"
AC=$(curl -s "$BASE/rest/v1/os_entries?day=eq.$TODAY&select=user_id" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
[ "$AC" -ge 1 ] && ok "admin vede le entries del team ($AC oggi)" || ko "admin non vede le entries"

echo "— os_targets —"
curl -s -X POST "$BASE/rest/v1/os_targets" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d '[{"role":"closer","kpi":"cash","daily":1234}]' >/dev/null
CV=$(curl -s "$BASE/rest/v1/os_targets?role=eq.closer&kpi=eq.cash&select=daily" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(d[0]['daily']) if d else -1)")
[ "$CV" = "1234" ] && ok "admin modifica target, collaboratore lo legge" || ko "target non propagato ($CV)"
RR=$(curl -s "$BASE/rest/v1/os_targets?select=role" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print('only' if set(x['role'] for x in d)=={'closer'} else 'leak')")
[ "$RR" = "only" ] && ok "collaboratore vede SOLO i target del suo ruolo" || ko "ISOLAMENTO target violato"
WT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/os_targets" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d '[{"role":"closer","kpi":"cash","daily":9999}]')
DV=$(curl -s "$BASE/rest/v1/os_targets?role=eq.closer&kpi=eq.cash&select=daily" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(d[0]['daily']) if d else -1)")
[ "$DV" = "1234" ] && ok "collaboratore NON può scrivere target (write bloccata)" || ko "SCRITTURA target non admin permessa ($DV)"

echo "— kpi_catalog (catalogo dinamico) —"
KC=$(curl -s "$BASE/rest/v1/kpi_catalog?select=kpi_key&limit=5" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
[ "$KC" -ge 1 ] && ok "collaboratore LEGGE il catalogo KPI ($KC)" || ko "collaboratore non legge catalogo"
curl -s -X PATCH "$BASE/rest/v1/kpi_catalog?role=eq.closer&kpi_key=eq.cash" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" -H "Content-Type: application/json" -d '{"daily":7777}' >/dev/null
KCW=$(curl -s "$BASE/rest/v1/kpi_catalog?role=eq.closer&kpi_key=eq.cash&select=daily" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(d[0]['daily']) if d else -1)")
[ "$KCW" != "7777" ] && ok "collaboratore NON può scrivere il catalogo (write bloccata)" || ko "SCRITTURA catalogo non admin permessa"

echo "— target_overrides —"
curl -s -X POST "$BASE/rest/v1/target_overrides" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "[{\"user_id\":\"$TID\",\"kpi_key\":\"cash\",\"daily\":1500}]" >/dev/null
OWN=$(curl -s "$BASE/rest/v1/target_overrides?select=daily" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(d[0]['daily']) if d else -1)")
[ "$OWN" = "1500" ] && ok "collaboratore legge il PROPRIO override" || ko "override proprio non letto ($OWN)"
OWB=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/target_overrides" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "[{\"user_id\":\"$TID\",\"kpi_key\":\"call\",\"daily\":99}]")
CNT=$(curl -s "$BASE/rest/v1/target_overrides?select=kpi_key" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
[ "$CNT" = "1" ] && ok "collaboratore NON può scrivere override (write bloccata)" || ko "SCRITTURA override non admin permessa ($CNT righe)"
curl -s -X DELETE "$BASE/rest/v1/target_overrides?user_id=eq.$TID" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" >/dev/null

echo "— os_suggestions (pre-compilazione) —"
curl -s -X POST "$BASE/rest/v1/os_suggestions" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "[{\"user_id\":\"$TID\",\"day\":\"$TODAY\",\"kpis\":{\"chiamate\":42},\"source\":\"test\"}]" >/dev/null
SUG=$(curl -s "$BASE/rest/v1/os_suggestions?day=eq.$TODAY&select=kpis" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(d[0]['kpis'].get('chiamate',-1)) if d else -1)")
[ "$SUG" = "42" ] && ok "collaboratore legge il PROPRIO suggerimento" || ko "suggerimento proprio non letto ($SUG)"
SUGW=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/os_suggestions" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "[{\"user_id\":\"$TID\",\"day\":\"$TODAY\",\"kpis\":{\"chiamate\":1},\"source\":\"hack\"}]")
SUGV=$(curl -s "$BASE/rest/v1/os_suggestions?user_id=eq.$TID&day=eq.$TODAY&select=kpis" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(d[0]['kpis'].get('chiamate',-1)) if d else -1)")
[ "$SUGV" = "42" ] && ok "collaboratore NON può scrivere suggerimenti (write bloccata)" || ko "SCRITTURA suggerimenti non admin permessa ($SUGV)"
curl -s -X DELETE "$BASE/rest/v1/os_suggestions?user_id=eq.$TID" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" >/dev/null

echo "— manager-reparto —"
CHAT_ID="11199b02-6534-4367-b0b5-42f6d56844d9"   # secondo utente → chatter
curl -s -X PATCH "$BASE/rest/v1/profiles?id=eq.$TID" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -d '{"role":"manager","sales_role":"closer"}' >/dev/null
curl -s -X PATCH "$BASE/rest/v1/profiles?id=eq.$CHAT_ID" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -d '{"sales_role":"chatter"}' >/dev/null
CH_JWT=$(jwt "alexbirle97@gmail.com")
curl -s -X POST "$BASE/rest/v1/os_entries" -H "apikey: $ANON" -H "Authorization: Bearer $CH_JWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "{\"user_id\":\"$CHAT_ID\",\"role\":\"chatter\",\"day\":\"$TODAY\",\"kpis\":{\"qualificati\":9}}" >/dev/null
MJWT=$(jwt "$COLLAB_EMAIL")  # ora è manager/closer
MROLES=$(curl -s "$BASE/rest/v1/os_entries?select=role" -H "apikey: $ANON" -H "Authorization: Bearer $MJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print('leak' if any(x['role']!='closer' for x in d) else 'ok')")
[ "$MROLES" = "ok" ] && ok "manager NON vede entries di altri reparti" || ko "MANAGER vede entries altrui"
MPROF=$(curl -s "$BASE/rest/v1/profiles?select=sales_role" -H "apikey: $ANON" -H "Authorization: Bearer $MJWT" | python3 -c "import sys,json;d=json.load(sys.stdin);print('leak' if 'chatter' in set(x.get('sales_role') for x in d) else 'ok')")
[ "$MPROF" = "ok" ] && ok "manager NON vede profili di altri reparti" || ko "MANAGER vede profili altrui"
# cleanup manager
curl -s -X DELETE "$BASE/rest/v1/os_entries?user_id=eq.$CHAT_ID&day=eq.$TODAY" -H "apikey: $ANON" -H "Authorization: Bearer $CH_JWT" >/dev/null
curl -s -X PATCH "$BASE/rest/v1/profiles?id=eq.$CHAT_ID" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -d '{"sales_role":null}' >/dev/null

echo "— cleanup —"
curl -s -X DELETE "$BASE/rest/v1/os_entries?user_id=eq.$TID&day=eq.$TODAY" -H "apikey: $ANON" -H "Authorization: Bearer $CJWT" >/dev/null
curl -s -X POST "$BASE/rest/v1/os_targets" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d '[{"role":"closer","kpi":"cash","daily":1000}]' >/dev/null
curl -s -X PATCH "$BASE/rest/v1/profiles?id=eq.$TID" -H "apikey: $ANON" -H "Authorization: Bearer $AJWT" -H "Content-Type: application/json" -d '{"sales_role":null,"role":"collaborator"}' >/dev/null
echo "  ripristino completato"

echo ""
echo "=== RISULTATO: $PASS passati, $FAIL falliti ==="
[ "$FAIL" -eq 0 ] || exit 1
