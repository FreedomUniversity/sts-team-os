#!/usr/bin/env bash
# ============================================================
# STS Performance OS — test RLS `marketing_months` (SICURO)
# Verifica lato server che un utente NON autenticato (solo anon key):
#   - NON possa leggere il piano marketing
#   - NON possa scriverlo
# Non fa login, non scrive nulla che persista. Idempotente e innocuo.
# Uso: ./tests/marketing_rls_test.sh
# ============================================================
set -e
REF=sbghltmjgllhsgioudlv
BASE="https://$REF.supabase.co"
ANON=$(grep -oE "SUPABASE_ANON *= *'[^']*'" "$(dirname "$0")/../app.js" | head -1 | sed "s/.*'\(.*\)'/\1/")
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
ko(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "— marketing_months · RLS (anon) —"

# 1) anon NON deve leggere (policy SELECT = solo authenticated) → body []
R=$(curl -s "$BASE/rest/v1/marketing_months?select=month" -H "apikey: $ANON")
[ "$R" = "[]" ] && ok "anon non legge il piano (body vuoto)" || ko "anon LEGGE il piano: $R"

# 2) anon NON deve scrivere (INSERT) → HTTP 401/403
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/marketing_months" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"month":"2099-01","label":"HACK","obiettivo":1}')
{ [ "$C" = "401" ] || [ "$C" = "403" ]; } && ok "anon non scrive il piano (HTTP $C)" || ko "anon SCRIVE il piano: HTTP $C"

# 3) conferma che la riga fantasma non sia stata creata (via REST anon resta cieco, ma ricontrolliamo che 2099-01 non esista lato letture aperte: già [] sopra)
echo
echo "Risultato: $PASS ok · $FAIL ko"
[ "$FAIL" = 0 ] && echo "✅ RLS marketing_months OK" || { echo "❌ RLS marketing_months COMPROMESSA"; exit 1; }
