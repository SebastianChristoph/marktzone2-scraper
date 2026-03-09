# mz-Scraper

Amazon product scraper for Marktzone2 — FastAPI backend (Playwright/Chromium), React admin UI, PostgreSQL.

---

## Production Deployment

### Architecture

```
marktzone2 server ──── HTTP ────► mz-scraper server
                               port 8001 (FastAPI backend)
                               port 5174 (Admin UI, optional)
                               PostgreSQL (internal only)
```

The marktzone2 backend calls this scraper via HTTP to create jobs and poll results.
Port 8001 should be **firewalled to only accept connections from the marktzone2 server IP**.

---

### Prerequisites

| What | Requirement |
|---|---|
| Server OS | Ubuntu 22.04+ (any Linux with Docker) |
| RAM | min. 2 GB (Chromium is memory-intensive) |
| Ports | 8001 open **from marktzone2 server IP only** (firewall rule) |
| Note | The scraper server does NOT need a public domain or HTTPS |

---

### Step 1 — Install Docker on the server

```bash
ssh root@your-scraper-server-ip

curl -fsSL https://get.docker.com | sh

docker --version
docker compose version
```

---

### Step 2 — Create a GitHub Deploy Key

**On the scraper server:**

```bash
ssh-keygen -t ed25519 -C "deploy@mz-scraper-server" -f ~/.ssh/github_scraper -N ""
cat ~/.ssh/github_scraper.pub
```

Copy the output.

**On GitHub:**

1. Go to the **mz-scraper repo** → **Settings** → **Deploy keys** → **Add deploy key**
2. Title: `Scraper Production Server`
3. Paste the public key
4. Leave "Allow write access" **unchecked**
5. Click **Add key**

**On the scraper server:**

```bash
cat >> ~/.ssh/config << 'EOF'

Host github-mz-scraper
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_scraper
    IdentitiesOnly yes
EOF
```

---

### Step 3 — Clone the repository

```bash
# Replace YOUR_ORG with your GitHub org/username
git clone git@github-mz-scraper:YOUR_ORG/mz-scraper.git
cd mz-scraper
```

---

### Step 4 — Create and fill the `.env` file

```bash
cp .env.example .env
nano .env
```

Fill it with:

```env
POSTGRES_PASSWORD=<generate with: openssl rand -base64 24>
VITE_LOCAL_MODE=false
```

Generate the password:

```bash
openssl rand -base64 24
```

---

### Step 5 — Create the screenshots directory

The scraper saves error screenshots here:

```bash
mkdir -p data/screenshots
```

---

### Step 6 — Deploy

```bash
docker compose -f docker-compose.server.yml up -d --build
```

Watch startup (Chromium installation takes 1–2 minutes on first build):

```bash
docker compose -f docker-compose.server.yml logs -f
```

---

### Step 7 — Verify

```bash
# All 3 containers should be "Up" (postgres, backend, frontend)
docker compose -f docker-compose.server.yml ps

# Backend health check
curl http://localhost:8001/health
# Expected: {"status":"ok"} or similar

# Admin UI
# Open http://<scraper-server-ip>:5174 in browser
```

---

### Step 8 — Firewall (important)

Port 8001 must only be reachable from the marktzone2 server — not the open internet:

```bash
# Allow marktzone2 server to reach port 8001
ufw allow from <MARKTZONE2_SERVER_IP> to any port 8001

# Block port 8001 from everyone else (if not already default-deny)
ufw deny 8001

# Optionally restrict Admin UI too (port 5174)
ufw allow from <YOUR_ADMIN_IP> to any port 5174
ufw deny 5174

ufw enable
ufw status
```

---

### Step 9 — Connect marktzone2 to this scraper

On the **marktzone2 server**, open its `.env` file and set:

```env
SCRAPER_BASE_URL=http://<scraper-server-ip>:8001
```

Then restart the marktzone2 backend:

```bash
# On the marktzone2 server:
cd marktzone2
docker compose restart backend
```

**Test the connection from the marktzone2 server:**

```bash
curl http://<scraper-server-ip>:8001/health
```

---

### Updating (pulling new code)

```bash
cd mz-scraper

git pull

docker compose -f docker-compose.server.yml up -d --build

docker image prune -f
```

---

### Useful commands

```bash
# View logs
docker compose -f docker-compose.server.yml logs -f
docker compose -f docker-compose.server.yml logs -f backend

# Restart backend only
docker compose -f docker-compose.server.yml restart backend

# Stop everything
docker compose -f docker-compose.server.yml down

# Stop + delete volumes (WARNING: deletes all job history and DB)
docker compose -f docker-compose.server.yml down -v

# Open a shell in the backend container
docker compose -f docker-compose.server.yml exec backend bash
```

---

### Troubleshooting

**Chromium crashes / out of memory:**
- Increase server RAM (2 GB minimum, 4 GB recommended for parallel scraping)
- Check: `docker compose -f docker-compose.server.yml logs backend`

**marktzone2 cannot reach port 8001:**
- Verify firewall allows marktzone2 server IP: `ufw status`
- Test from marktzone2 server: `curl http://<scraper-ip>:8001/health`
- Confirm backend container is running: `docker compose -f docker-compose.server.yml ps`

**Screenshots directory permission error:**
- Run: `chmod -R 777 data/screenshots`

**Database connection error on startup:**
- PostgreSQL may still be initializing — wait 10 seconds and check again
- `docker compose -f docker-compose.server.yml logs postgres`

---

## Local Development

See `start_scraper_local.bat` (Windows).

Requirements: Python 3.12, Node.js 20+, Playwright (`playwright install chromium`)
