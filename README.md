# Provue Take-Home: Tara — Finance Research Agent

## What This Is
Tara is a personal finance research AI agent. Users ask natural language questions about their spending and investments. Tara calls SQL-backed tools to retrieve real numbers and returns grounded answers.

**Live URL:** https://provue-tara-production.up.railway.app

---

## Quick Start (Local)

### Prerequisites
- Node.js 18+
- Docker (for Postgres)
- Groq API key (free at https://console.groq.com)

### 1. Clone and install
```bash
git clone https://github.com/Mastercoder0406/Provue-Tara.git
cd provue-tara
npm install
```

### 2. Start Postgres
```bash
docker run -d --name provue-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
```

### 3. Create .env
```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/provue_tara
GROQ_API_KEY=your_groq_key_here
PORT=3000
```

### 4. Create database
```bash
psql -U postgres -h localhost -c "CREATE DATABASE provue_tara;"
```

### 5. Run schema
```bash
psql -U postgres -h localhost -d provue_tara -f scripts/schema.sql
```

### 6. Ingest sample data
```bash
# Mac/Linux
DATA_DIR=./data/sample_a npx tsx scripts/ingest.ts

# Windows PowerShell
$env:DATA_DIR="./data/sample_a"; npx tsx scripts/ingest.ts
```

### 7. Start server
```bash
npm start
```

### 8. Test
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How much did I spend in total?"}'
```

---

## Running the Eval Suite
```bash
# Make sure server is running first
npm run eval

# Against deployed URL
EVAL_URL=https://YOUR-RAILWAY-URL.up.railway.app npm run eval
```

---

## Ingest Contract
The ingest script accepts any snapshot path via `DATA_DIR`:
```bash
DATA_DIR=./data/sample_a npx tsx scripts/ingest.ts
DATA_DIR=./data/sample_b npx tsx scripts/ingest.ts
DATA_DIR=./data/sample_c npx tsx scripts/ingest.ts
```

Each snapshot must contain `transactions.json`, `funds.json`, `holdings.json`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `GROQ_API_KEY` | Yes | Groq API key (free tier works) |
| `PORT` | No | Server port (default 3000) |

---

## Model and Provider
- **Provider:** Groq (free tier)
- **Model:** llama-3.3-70b-versatile
- **Why Groq:** Free tier, fast inference, supports tool calling

---

## Deployment
Deployed on **Railway** with managed Postgres.

- App URL: `https://provue-tara-production.up.railway.app`
- POST /ask — main endpoint
- GET /health — health check
- GET /logs — last 20 request logs

---

## Project Structure
```
provue-tara/
├── data/
│   ├── sample_a/
│   ├── sample_b/
│   └── sample_c/
├── scripts/
│   ├── schema.sql      — database schema
│   ├── ingest.ts       — data loader
│   └── eval.ts         — evaluation suite
├── src/
│   ├── db.ts           — postgres connection
│   ├── agent.ts        — Tara agent definition
│   ├── server.ts       — Express POST /ask
│   └── tools/
│       ├── queryTransactions.ts
│       ├── getMerchantAliases.ts
│       ├── getFundReturns.ts
│       └── getHoldingReturns.ts
├── logs/               — request logs (gitignored)
├── .env                — local secrets (gitignored)
└── package.json
```

---

## Known Limitations
- Groq free tier: 100k tokens/day, 12k TPM — eval runs slowly (10s delay between questions)
- Cold start on Railway free tier: first request may take 5-10 seconds
- Relative date "today" is computed at server start, not per request (minor issue)
- Async milestone not implemented (optional per assignment)