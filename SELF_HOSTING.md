# Self-Hosting Guide

Deploy Multica on your own infrastructure in minutes.

## Architecture

| Component | Description | Technology |
|-----------|-------------|------------|
| **Backend** | REST API + WebSocket server | Go (single binary) |
| **Frontend** | Web application | Next.js 16 |
| **Database** | Primary data store | PostgreSQL 17 with pgvector |

Each user who runs AI agents locally also installs the **`multica` CLI** and runs the **agent daemon** on their own machine.

## Quick Install (Recommended)

Two commands to set up everything — server, CLI, and configuration:

```bash
# 1. Install CLI + provision the self-host server
curl -fsSL https://raw.githubusercontent.com/charlesanim/multica/main/scripts/install.sh | bash -s -- --with-server

# 2. Configure CLI, authenticate, and start the daemon
multica setup self-host
```

This clones the repository, starts all services via Docker Compose, installs the `multica` CLI, then configures it for localhost.

Open http://localhost:3000. To log in, configure `RESEND_API_KEY` in `.env` for email-based codes (recommended), or set `APP_ENV=development` in `.env` to enable the dev master code **`888888`**. See [Step 2 — Log In](#step-2--log-in) for details.

> **Prerequisites:** Docker and Docker Compose must be installed. The script checks for this and provides install links if missing.
>
> **CLI only?** If the self-host server is already running and you only need the CLI on a macOS/Linux machine, install it with Homebrew:
>
> ```bash
> brew install charlesanim/tap/multica
> ```

---

## Step-by-Step Setup (Alternative)

If you prefer to run each step manually:

### Step 1 — Start the Server

**Prerequisites:** Docker and Docker Compose.

```bash
git clone https://github.com/charlesanim/multica.git
cd multica
make selfhost
```

`make selfhost` automatically creates `.env` from the example, generates a random `JWT_SECRET`, and starts all services via Docker Compose.

Once ready:

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8080

> **Note:** If you prefer to run the Docker Compose steps manually, see [Manual Docker Compose Setup](#manual-docker-compose-setup) below.

### Step 2 — Log In

Open http://localhost:3000 in your browser. The Docker self-host stack defaults to `APP_ENV=production` (set in `docker-compose.selfhost.yml`), so the dev master code is **disabled by default** for safety on public deployments. Pick one of the following to log in:

- **Recommended (production):** configure `RESEND_API_KEY` in `.env`, then restart the backend. Real verification codes will be sent to the email address you enter. See [Advanced Configuration → Email](SELF_HOSTING_ADVANCED.md#email-required-for-authentication).
- **Evaluation / private network:** set `APP_ENV=development` in `.env` and restart the backend. Verification code **`888888`** will then work for any email address.
- **Without configuring either:** the verification code is generated server-side and printed to the backend container logs (look for `[DEV] Verification code for ...:`). Useful for one-off testing on a single machine.

> **Warning:** do **not** set `APP_ENV=development` on a publicly reachable instance — anyone who knows an email address can then log in with `888888`.

### Step 3 — Install CLI & Start Daemon

The daemon runs on your local machine (not inside Docker). It detects installed AI agent CLIs, registers them with the server, and executes tasks when agents are assigned work.

Each team member who wants to run AI agents locally needs to:

### a) Install the CLI and an AI agent

```bash
brew install charlesanim/tap/multica
```

You also need at least one AI agent CLI installed:
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` on PATH)
- [Codex](https://github.com/openai/codex) (`codex` on PATH)
- [OpenClaw](https://github.com/openclaw/openclaw) (`openclaw` on PATH)
- [OpenCode](https://github.com/anomalyco/opencode) (`opencode` on PATH)
- [Hermes](https://github.com/NousResearch/hermes) (`hermes` on PATH)
- Gemini (`gemini` on PATH)
- [Pi](https://pi.dev/) (`pi` on PATH)
- [Cursor Agent](https://cursor.com/) (`cursor-agent` on PATH)

### b) One-command setup

```bash
multica setup self-host
```

This automatically:
1. Configures the CLI to connect to `localhost` (ports 8080/3000)
2. Opens your browser for authentication
3. Discovers your workspaces
4. Starts the daemon in the background

For on-premise deployments with custom domains:

```bash
multica setup self-host --server-url https://api.example.com --app-url https://app.example.com
```

To verify the daemon is running:

```bash
multica daemon status
```

> **Alternative:** If you prefer manual steps, see [Manual CLI Configuration](#manual-cli-configuration) below.

### Step 4 — Verify & Start Using

1. Open your workspace in the web app at http://localhost:3000
2. Navigate to **Settings → Runtimes** — you should see your machine listed
3. Go to **Settings → Agents** and create a new agent
4. Create an issue and assign it to your agent — it will pick up the task automatically

## Stopping Services

If you installed via the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/charlesanim/multica/main/scripts/install.sh | bash -s -- --stop
```

If you cloned the repo manually:

```bash
# Stop the Docker Compose services (backend, frontend, database)
make selfhost-stop

# Stop the local daemon
multica daemon stop
```

## Switching to Multica Cloud

If you've been self-hosting and want to switch your CLI to [Multica Cloud](https://multica.ai):

```bash
multica setup
```

This reconfigures the CLI for multica.ai, re-authenticates, and restarts the daemon. You will be prompted before overwriting the existing configuration.

> Your local Docker services are unaffected. Stop them separately if you no longer need them.

## Rebuilding After Updates

```bash
git pull
make selfhost
```

Migrations run automatically on backend startup.

---

## Manual Docker Compose Setup

If you prefer running Docker Compose steps manually instead of `make selfhost`:

```bash
git clone https://github.com/charlesanim/multica.git
cd multica
cp .env.example .env
```

Edit `.env` — at minimum, change `JWT_SECRET`:

```bash
JWT_SECRET=$(openssl rand -hex 32)
```

Then start everything:

```bash
docker compose -f docker-compose.selfhost.yml up -d
```

## Manual CLI Configuration

If you prefer configuring the CLI step by step instead of `multica setup`:

```bash
# Point CLI to your local server
multica config set server_url http://localhost:8080
multica config set app_url http://localhost:3000

# Login (opens browser)
multica login

# Start the daemon
multica daemon start
```

For production deployments with TLS:

```bash
multica config set app_url https://app.example.com
multica config set server_url https://api.example.com
multica login
multica daemon start
```

## Advanced Configuration

For environment variables, manual setup (without Docker), reverse proxy configuration, database setup, and more, see the [Advanced Configuration Guide](SELF_HOSTING_ADVANCED.md).

---

## Tailscale Setup (Secure Remote Access)

Access your self-hosted Multica from anywhere using Tailscale — your own private, encrypted network. No ports are exposed to the public internet.

### What you get

- **HTTPS** with auto-provisioned TLS certificates (via Tailscale Serve)
- **Private access** — only your Tailscale-connected devices (laptop, phone, etc.) can reach it
- **Obscured hostname** — configurable name that doesn't reveal what the service is
- **Non-standard ports** — internal ports 4800/4900 instead of 3000/8080

### Prerequisites

- Tailscale installed on your server and all devices you want to access from
- A Tailscale account (free for personal use)

### 1. Generate a Tailscale auth key

Go to https://login.tailscale.com/admin/settings/keys → **Generate auth key**. Check **Reusable** for convenience.

### 2. Find your tailnet name

```bash
tailscale status --json | grep MagicDNSSuffix
# Example output: "MagicDNSSuffix": "tail8d788f.ts.net"
```

### 3. Configure your `.env`

```bash
# Tailscale
TS_AUTHKEY=tskey-auth-xxxxx
TS_HOSTNAME=hub                      # Pick any name — this is NOT "multica"
TS_TAILNET=tail8d788f.ts.net         # Your tailnet suffix from step 2

# Auth
JWT_SECRET=your-random-secret
MULTICA_LOCAL_MODE=true              # Auto-login (safe — only your devices can reach it)
NEXT_PUBLIC_LOCAL_MODE=true
```

### 4. Enable HTTPS in your Tailscale ACL

In the [Tailscale admin console](https://login.tailscale.com/admin/acls), ensure your ACL policy includes:

```json
{
  "nodeAttrs": [
    {
      "target": ["tag:container"],
      "attr": ["funnel"]
    }
  ]
}
```

This allows the container to provision HTTPS certificates.

### 5. Start the stack

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
```

### 6. Access

From any device on your Tailscale network:

```
https://hub.tail8d788f.ts.net
```

(Replace `hub` and `tail8d788f.ts.net` with your values.)

### 7. Start the daemon (on the same machine)

```bash
MULTICA_LOCAL_MODE=true \
MULTICA_SERVER_URL=ws://127.0.0.1:4900/ws \
./server/bin/multica daemon start
```

### 8. Connect MCP server (from any device)

Add to your Claude Code, Copilot CLI, or Cursor MCP config:

```json
{
  "mcpServers": {
    "tasks": {
      "command": "npx",
      "args": ["tsx", "/path/to/multica/packages/mcp/src/index.ts"],
      "env": {
        "MULTICA_URL": "https://hub.tail8d788f.ts.net",
        "MULTICA_TOKEN": "mul_your_token_here"
      }
    }
  }
}
```

Then from any agent: *"File a work item: Add dark mode. Assign to Copilot, high priority."*

### Security notes

| Layer | Protection |
|-------|-----------|
| **Network** | Tailscale WireGuard mesh — only your devices can reach the server |
| **DNS** | `*.ts.net` is a private zone — doesn't resolve outside your tailnet |
| **TLS** | HTTPS with auto-provisioned certificates via Tailscale Serve |
| **Hostname** | Configurable — doesn't reveal the service name |
| **Ports** | Non-standard internal ports (4800/4900) — not exposed to host |
| **Auth** | Local mode is safe here since network access is already restricted |
