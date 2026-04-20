#!/bin/bash
# ──────────────────────────────────────────────────────────────
# Multica Migration Script: Export from this machine
#
# Exports your entire Multica setup (database + config) into a
# portable bundle that can be imported on the Mac Mini.
#
# Usage:
#   ./scripts/export-setup.sh
#
# Output: multica-export/ directory with:
#   - db-dump.sql       (full database: agents, workspace, issues, etc.)
#   - env.production    (.env configured for the Mac Mini + Tailscale)
#   - docker-compose.yml + docker-compose.tailscale.yml (copies)
#   - README-import.md  (instructions for the Mac Mini)
# ──────────────────────────────────────────────────────────────

set -euo pipefail

EXPORT_DIR="multica-export"
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

echo "📦 Exporting Multica setup..."

# 1. Database dump (everything: users, workspace, agents, issues, skills, etc.)
echo "  → Dumping database..."
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-multica}" "${POSTGRES_DB:-multica}" \
  --no-owner --no-privileges --clean --if-exists \
  > "$EXPORT_DIR/db-dump.sql"
DB_LINES=$(wc -l < "$EXPORT_DIR/db-dump.sql")
echo "    ✅ Database exported ($DB_LINES lines)"

# 2. Copy .env as template
echo "  → Creating .env template for Mac Mini..."
cp .env "$EXPORT_DIR/env.current"

cat > "$EXPORT_DIR/env.production" << 'ENVEOF'
# ── Multica Mac Mini Config ──
# Database
POSTGRES_DB=multica
POSTGRES_USER=multica
POSTGRES_PASSWORD=multica
POSTGRES_PORT=5432
DATABASE_URL=postgres://multica:multica@postgres:5432/multica?sslmode=disable

# Server
PORT=8080
JWT_SECRET=CHANGE_ME_TO_RANDOM_STRING

# Local mode (auto-login — safe behind Tailscale)
MULTICA_LOCAL_MODE=true
MULTICA_LOCAL_EMAIL=local@localhost
NEXT_PUBLIC_LOCAL_MODE=true

# Frontend
FRONTEND_PORT=3000
FRONTEND_ORIGIN=http://localhost:3000

# Tailscale (fill in your values)
# TS_AUTHKEY=tskey-auth-...
# TS_HOSTNAME=hub
# TS_TAILNET=tail8d788f.ts.net
ENVEOF
echo "    ✅ .env template created"

# 3. Create import instructions
cat > "$EXPORT_DIR/README-import.md" << 'EOF'
# Importing Multica to Mac Mini

## Prerequisites

On the Mac Mini, install:
- Docker Desktop (or colima + docker)
- Git
- Copilot CLI: `brew install gh && gh copilot install` (or however you installed it)
- Tailscale (already installed)

## Steps

### 1. Clone the repo

```bash
git clone https://github.com/charlesanim/multica.git
cd multica
```

### 2. Copy the config

```bash
cp /path/to/multica-export/env.production .env
# Edit .env — set JWT_SECRET to a random string:
#   openssl rand -hex 32
# Set your Tailscale auth key (TS_AUTHKEY)
```

### 3. Start the stack (without Tailscale first)

```bash
MULTICA_LOCAL_MODE=true NEXT_PUBLIC_LOCAL_MODE=true docker compose up -d
docker compose ps  # wait for all healthy
```

### 4. Import the database

```bash
# This replaces the empty database with your full setup
docker compose exec -T postgres psql -U multica multica < /path/to/multica-export/db-dump.sql
```

### 5. Restart to pick up the imported data

```bash
docker compose restart backend
```

### 6. Verify

```bash
curl http://localhost:8080/health
# Should return: {"status":"ok"}
```

### 7. Build and start the daemon

```bash
make build
MULTICA_LOCAL_MODE=true MULTICA_SERVER_URL=ws://localhost:8080/ws \
  ./server/bin/multica daemon start --foreground
```

You should see your agents (Mac, Dillon, Poncho, etc.) register as runtimes.

### 8. (Optional) Enable Tailscale

```bash
# Edit .env — uncomment and fill in:
#   TS_AUTHKEY=tskey-auth-...
#   TS_HOSTNAME=hub
#   TS_TAILNET=tail8d788f.ts.net

docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

Access from any Tailscale device: `https://hub.tail8d788f.ts.net`

### 9. Set up as always-on

```bash
# Disable sleep
sudo pmset -a disablesleep 1

# Create a launchd plist for the daemon (auto-start on boot)
# See SELF_HOSTING.md for details
```
EOF
echo "    ✅ Import instructions created"

echo ""
echo "✅ Export complete! Files in: $EXPORT_DIR/"
echo ""
echo "Transfer to Mac Mini via:"
echo "  scp -r $EXPORT_DIR charlesanim@charless-mac-mini.tail8d788f.ts.net:~/"
echo ""
echo "Or via AirDrop / USB drive / any method you prefer."
