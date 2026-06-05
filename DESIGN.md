# DESIGN.md — Tara Finance Research Agent

## 1. Postgres Schema

### Tables

```sql
transactions (
  id            TEXT PRIMARY KEY,
  date          DATE NOT NULL,
  merchant      TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'uncategorized',
  amount        NUMERIC(12,2) NOT NULL,  -- negative = refund
  currency      TEXT NOT NULL DEFAULT 'INR',
  memo          TEXT
)

funds (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT NOT NULL
)

fund_nav (
  fund_id  TEXT NOT NULL REFERENCES funds(id),
  date     DATE NOT NULL,
  nav      NUMERIC(12,4) NOT NULL,
  PRIMARY KEY (fund_id, date)
)

holdings (
  id            TEXT PRIMARY KEY,
  fund_id       TEXT NOT NULL REFERENCES funds(id),
  fund_name     TEXT NOT NULL,
  units         NUMERIC(12,4) NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_nav  NUMERIC(12,4) NOT NULL
)
```

### Indexes
```sql
CREATE INDEX idx_transactions_date     ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(category);
CREATE INDEX idx_transactions_merchant ON transactions(merchant);
CREATE INDEX idx_transactions_amount   ON transactions(amount);
CREATE INDEX idx_fund_nav_fund_date    ON fund_nav(fund_id, date);
```

### Why this schema
- `transactions` is flat — every filter (date, category, merchant, amount) has an index
- `fund_nav` uses `(fund_id, date)` as primary key — one row per fund per NAV point, natural for LATERAL joins to find closest NAV
- `holdings` stores purchase cost at time of buy — needed to compute realised return without relying on historical reconstruction
- No ORM — raw SQL via `pg` for full control over query shape

---

## 2. Tool Design

### Four tools, why split this way

| Tool | Responsibility |
|---|---|
| `query_transactions` | All spending queries — totals, top merchants, monthly, recurring, compare |
| `get_merchant_aliases` | Find all merchant name variants in DB before querying |
| `get_fund_returns` | Fund period return (NAV change between two dates) |
| `get_holding_returns` | User's personal P&L on holdings (units × NAV vs purchase cost) |

**Why not more tools:** Every tool definition goes into the model context on every turn. More tools = more tokens = worse selection accuracy. Four focused tools beat ten narrow ones.

**Why not fewer:** Merchant alias lookup is a separate concern from transaction aggregation. Fund return vs holding return are different computations — separating them forces the model to pick the right one.

---

## 3. Grounding — How We Prevent Hallucination

Every number in Tara's answer comes from a tool query result. The agent instructions say:

> "Only answer from tool results. Never invent numbers. If noData=true say 'No data found'."

Tools return explicit `noData: true` when DB returns 0 rows — the model cannot confuse empty results with zero spend.

Math is computed in SQL/code — not by the model:
- Totals: `SUM(amount)` in SQL
- Growth rates: computed in tool execute function, returned as `growthSummary`
- Rankings: `ORDER BY net_spend DESC` in SQL, rank added in code
- Returns: `(endNav - startNav) / startNav * 100` in tool code

---

## 4. Formulas

### Spend
```
gross_spend = SUM(amount) WHERE amount > 0
refunds     = SUM(amount) WHERE amount < 0
net_spend   = gross_spend + refunds  (same as SUM(amount))
```
Transfers excluded: `WHERE LOWER(category) != 'transfer'`

### Merchant Matching
1. `get_merchant_aliases` runs: `WHERE LOWER(merchant) LIKE LOWER('%searchTerm%')`
2. Returns all exact merchant strings found in DB
3. `query_transactions` uses: `WHERE merchant IN (variant1, variant2, ...)`

This handles Swiggy/SWIGGY*ORDER/Swiggy Instamart without hardcoding.

### Recurring Detection
A merchant is recurring if it appears in 2+ distinct calendar months.
Confidence scoring:
- `high`: 6+ months active, stddev(amount) < 5, stddev(day_of_month) < 5
- `medium`: 3+ months active, stddev(amount) < 50
- `low`: 2+ months active, anything else

### Fund Period Return
```
period_return % = (end_nav - start_nav) / start_nav × 100
```
Where `start_nav` = closest NAV on or after start date (LATERAL JOIN, ORDER BY date ASC LIMIT 1)
And `end_nav` = closest NAV on or before end date (LATERAL JOIN, ORDER BY date DESC LIMIT 1)

### Holding Realised Return
```
purchase_cost  = units × purchase_nav
current_value  = units × latest_nav
absolute_return = current_value - purchase_cost
return %        = (current_value - purchase_cost) / purchase_cost × 100
```
`latest_nav` = most recent NAV in fund_nav for that fund_id

### Fund Period Return vs Holding Realised Return
These are different:
- **Fund period return**: how much the fund's NAV changed between two dates — independent of what the user paid
- **Holding realised return**: how much the user personally made — depends on when they bought and at what price

---

## 5. Evals

The eval suite (`scripts/eval.ts`) covers 15 questions:
- Single lookup, date filtering (Q01-Q03)
- Refunds and net spend (Q04)
- Merchant aliases (Q05)
- Top merchants ranking (Q06)
- Transfer exclusion (Q07)
- Category comparison + growth (Q08)
- Recurring subscriptions (Q09)
- No-data case (Q10)
- Fund period return + ranking (Q11, Q13)
- Portfolio value + realised return (Q12, Q14)
- Month-over-month (Q15)

Run with: `npm run eval`
Checks use keyword + number matching on the answer string. Pass = answer contains the expected signal.

---

## 6. Observability

Every POST /ask request logs to `logs/tara.log` and console:
- `request_received`: requestId, timestamp, question
- `request_completed`: answer, toolsUsed, toolInputs, tablesRead, latencyMs, status
- `request_failed`: error message, latencyMs, status

View last 20 entries: `GET /logs`

Tool names extracted from `result.steps[].toolCalls[]` (Mastra internal structure).

---

## 7. Deployment

- **Platform:** Railway
- **App:** Node.js service running `tsx src/server.ts`
- **Database:** Railway managed Postgres 16
- **Env vars set on Railway:** GROQ_API_KEY, DATABASE_URL, PORT

Railway auto-deploys on push to `main` branch.

---

## 8. Async Milestone

Not implemented. Decision: the assignment marks this as optional, and the 8-10 hour budget was better spent on correctness, grounding, and eval coverage. With more time, the approach would be:
- BullMQ + Redis for job queue
- Tools return `{job_id, status: "running"}` for slow operations
- Background worker stores result in `jobs` table in Postgres
- Synthetic system message feeds result back to agent on completion

---

## 9. Known Failure Modes + What I'd Fix

| Failure | Root cause | Fix with more time |
|---|---|---|
| Groq rate limits during eval | Free tier 100k tokens/day | Switch to paid tier or Anthropic |
| Merchant matching misses if no substring overlap | LIKE search only | Add fuzzy matching (pg_trgm extension) |
| "Today" date computed at server start | `getDateContext()` called once | Call per request or pass as tool argument |
| Cold start latency on Railway free tier | Container spin-up | Upgrade to paid or use always-on |
| Async milestone missing | Time constraint | BullMQ + Redis (documented above) |