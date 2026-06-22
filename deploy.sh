#!/usr/bin/env bash
# ============================================================================
# STS Performance OS — deploy con auto-bump del Service Worker
# Uso:  ./deploy.sh "messaggio di commit"
# Fa:   1) valida la sintassi di app.js  2) bumpa sts-vN -> sts-v(N+1) in sw.js
#       3) commit + push su main (GitHub Pages pubblica in ~1-2 min)
# Perché: il bump del SW a mano era la causa dei "dati vecchi in cache". Ora è automatico.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "❌ Serve un messaggio di commit:  ./deploy.sh \"cosa hai cambiato\""
  exit 1
fi

# 1) Validazione sintassi — blocca il deploy se app.js è rotto
if command -v node >/dev/null 2>&1; then
  node --check app.js || { echo "❌ app.js ha errori di sintassi — deploy ANNULLATO"; exit 1; }
  echo "✓ app.js: sintassi OK"
else
  echo "⚠️  node non trovato: salto la validazione sintassi"
fi

# 2) Auto-bump Service Worker (sts-vN -> sts-v(N+1))
CUR=$(grep -oE "sts-v[0-9]+" sw.js | head -1)
if [ -z "$CUR" ]; then echo "❌ Versione SW non trovata in sw.js"; exit 1; fi
NUM=${CUR#sts-v}
NEW="sts-v$((NUM+1))"
if sed --version >/dev/null 2>&1; then sed -i "s/${CUR}/${NEW}/" sw.js; else sed -i '' "s/${CUR}/${NEW}/" sw.js; fi
echo "✓ Service Worker: ${CUR} → ${NEW} (forza l'update cache su tutto il team)"

# 3) Commit + push
git add -A
git commit -q -m "${MSG} (${NEW})"
git push origin main
echo "✓ Deployato. GitHub Pages aggiorna in ~1-2 min."
echo "  Il team prende ${NEW} alla prossima apertura — niente più dati in cache vecchia."
