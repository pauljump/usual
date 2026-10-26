#!/usr/bin/env bash
# One-command deploy of The Swarm to Cloudflare Workers + D1.
#   ANTHROPIC_API_KEY=sk-ant-... ./scripts/go-live.sh
# Safe to re-run. Generated secrets are kept in .swarm-secrets (mode 600,
# gitignored) so the pre-load and handle scripts can use them.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/6 Installing dependencies"
npm ci --no-audit --no-fund

say "2/6 Checking Cloudflare login"
if ! npx wrangler whoami 2>/dev/null | grep -qi "associated with"; then
  npx wrangler login
fi

say "3/6 Database"
if grep -q "REPLACE_WITH_ID" wrangler.toml; then
  out=$(npx wrangler d1 create thought-swarm 2>&1 || true)
  id=$(printf '%s' "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$id" ]; then
    id=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const db=JSON.parse(s).find(d=>d.name==="thought-swarm");console.log(db?db.uuid:"")})')
  fi
  [ -n "$id" ] || { echo "Could not create or find the D1 database:"; echo "$out"; exit 1; }
  sed -i.bak "s/REPLACE_WITH_ID_FROM_wrangler_d1_create/$id/" wrangler.toml && rm -f wrangler.toml.bak
  echo "Using D1 database $id"
else
  echo "Already configured."
fi

say "4/6 Secrets"
touch .swarm-secrets && chmod 600 .swarm-secrets
# shellcheck disable=SC1091
. ./.swarm-secrets
: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY when running this script}"
SWARM_AGENT_SALT=${SWARM_AGENT_SALT:-$(openssl rand -hex 32)}
SWARM_ADMIN_TOKEN=${SWARM_ADMIN_TOKEN:-$(openssl rand -hex 24)}
A2A_BEARER_TOKEN=${A2A_BEARER_TOKEN:-$(openssl rand -hex 24)}
cat > .swarm-secrets <<SECRETS
SWARM_AGENT_SALT=$SWARM_AGENT_SALT
SWARM_ADMIN_TOKEN=$SWARM_ADMIN_TOKEN
A2A_BEARER_TOKEN=$A2A_BEARER_TOKEN
SECRETS
if [ -n "${ARELAY_VERIFICATION_TOKEN:-}" ]; then echo "ARELAY_VERIFICATION_TOKEN=$ARELAY_VERIFICATION_TOKEN" >> .swarm-secrets; fi

say "5/6 Deploying"
deploy_out=$(npx wrangler deploy 2>&1) || { echo "$deploy_out"; exit 1; }
url=$(printf '%s' "$deploy_out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
for name in ANTHROPIC_API_KEY SWARM_AGENT_SALT SWARM_ADMIN_TOKEN A2A_BEARER_TOKEN ARELAY_VERIFICATION_TOKEN; do
  value=${!name:-}
  [ -n "$value" ] && printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null && echo "secret $name set"
done
host=${SWARM_HOST:-${url#https://}}
if grep -q 'swarm.example.com' wrangler.toml; then
  node scripts/set-host.mjs "$host"
  npx wrangler deploy >/dev/null
fi
grep -q "^SWARM_URL=" .swarm-secrets || echo "SWARM_URL=https://$host" >> .swarm-secrets

say "6/6 Smoke test against https://$host"
curl -fsS "https://$host/health" && echo
curl -fsS "https://$host/read?format=text&url=https://nodejs.org/api/sqlite.html" | tail -4

say "Live at https://$host"
echo "Scoreboard:   https://$host/live"
echo "MCP install:  claude mcp add --transport http swarm https://$host/mcp"
echo "Next:         npx tsx scripts/build-seed-list.ts && set -a && . ./.swarm-secrets && set +a && npx tsx scripts/preload.ts"
