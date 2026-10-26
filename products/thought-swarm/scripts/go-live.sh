#!/usr/bin/env bash
# Deploy a Thought Swarm instance to Cloudflare Workers + D1.
#   ANTHROPIC_API_KEY=sk-ant-... ./scripts/go-live.sh [host]
#
# On the account that owns the database in wrangler.toml (the canonical
# instance) it deploys wrangler.toml as is. On any other account it writes
# wrangler.own.toml (gitignored) with your own database, no custom-domain
# route unless you pass a host, and deploys that, so the committed config is
# never edited. Generated secrets are kept in .swarm-secrets (mode 600,
# gitignored) for the seeding scripts. Safe to re-run.
# Cloudflare auth: CLOUDFLARE_API_TOKEN if set, otherwise `wrangler login`.
set -euo pipefail
cd "$(dirname "$0")/.."

host=${1:-${SWARM_HOST:-}}
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/6 Installing dependencies"
npm ci --no-audit --no-fund

say "2/6 Checking Cloudflare login"
if ! npx wrangler whoami 2>/dev/null | grep -qi "associated with"; then
  npx wrangler login
fi

say "3/6 Database"
canonical_id=$(sed -n 's/^database_id = "\(.*\)"/\1/p' wrangler.toml)
dbs=$(npx wrangler d1 list --json)
owns() { printf '%s' "$dbs" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(JSON.parse(s).some(d=>d.uuid===process.argv[1])?0:1))' "$1"; }
if owns "$canonical_id"; then
  config=wrangler.toml
  echo "This account owns the canonical database; deploying wrangler.toml."
else
  config=wrangler.own.toml
  id=$(printf '%s' "$dbs" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const db=JSON.parse(s).find(d=>d.name==="thought-swarm");console.log(db?db.uuid:"")})')
  if [ -z "$id" ]; then
    out=$(npx wrangler d1 create thought-swarm 2>&1) || { echo "$out"; exit 1; }
    id=$(printf '%s' "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  fi
  [ -n "$id" ] || { echo "Could not create or find a D1 database named thought-swarm."; exit 1; }
  node scripts/own-config.mjs "$id" "$host" > "$config"
  echo "Using your D1 database $id; wrote $config."
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

say "5/6 Deploying"
deploy_out=$(npx wrangler deploy --config "$config" 2>&1) || { echo "$deploy_out"; exit 1; }
workers_url=$(printf '%s' "$deploy_out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
for name in ANTHROPIC_API_KEY SWARM_AGENT_SALT SWARM_ADMIN_TOKEN A2A_BEARER_TOKEN; do
  printf '%s' "${!name}" | npx wrangler secret put "$name" --config "$config" >/dev/null && echo "secret $name set"
done
if [ "$config" = wrangler.own.toml ] && [ -z "$host" ]; then
  # PUBLIC_BASE_URL is only known after the first deploy on workers.dev.
  node scripts/own-config.mjs "$id" "" "$workers_url" > "$config"
  npx wrangler deploy --config "$config" >/dev/null
fi
base=$(sed -n 's/^PUBLIC_BASE_URL = "\(.*\)"/\1/p' "$config")
echo "SWARM_URL=$base" >> .swarm-secrets

say "6/6 Smoke test against $base"
curl -fsS "$base/health" && echo

say "Live at $base"
echo "Home:         $base/live"
echo "MCP install:  claude mcp add --transport http swarm $base/mcp"
echo "Seeding:      see docs/operations.md"
