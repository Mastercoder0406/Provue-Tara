import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import * as dotenv from "dotenv";

// Load .env
dotenv.config();

// Check DATA_DIR is set
const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) {
    console.error("❌ ERROR: Set DATA_DIR before running.");
    console.error("   Example: DATA_DIR=./data/sample_a npx tsx scripts/ingest.ts");
    process.exit(1);
}

// Connect to Postgres
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Helper: load JSON file from DATA_DIR
function loadJson<T>(filename: string): T {
    const filepath = path.join(DATA_DIR!, filename);
    if (!fs.existsSync(filepath)) {
        throw new Error(`File not found: ${filepath}`);
    }
    const raw = fs.readFileSync(filepath, "utf-8");
    return JSON.parse(raw) as T;
}

// Step 1: Clear all tables
async function clearTables(client: any) {
    await client.query("DELETE FROM holdings");
    await client.query("DELETE FROM fund_nav");
    await client.query("DELETE FROM funds");
    await client.query("DELETE FROM transactions");
    console.log("✓ Tables cleared");
}

// Step 2: Ingest transactions.json
async function ingestTransactions(client: any) {
    const rows = loadJson<any[]>("transactions.json");
    let count = 0;

    for (const row of rows) {
        await client.query(
            `INSERT INTO transactions (id, date, merchant, category, amount, currency, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
            [
                String(row.id),
                row.date,
                row.merchant,
                row.category ?? "uncategorized",
                Number(row.amount),
                row.currency ?? "INR",
                row.memo ?? null,
            ]
        );
        count++;
    }
    console.log(`✓ Transactions: ${count} rows inserted`);
}

// Step 3: Ingest funds.json + NAV points
async function ingestFunds(client: any) {
    const funds = loadJson<any[]>("funds.json");

    for (const fund of funds) {
        // Insert fund
        await client.query(
            `INSERT INTO funds (id, name, category)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
            [fund.id, fund.name, fund.category]
        );

        // NAV array — handle different field names
        const navPoints: any[] =
            fund.nav ??
            fund.nav_history ??
            fund.navHistory ??
            fund.navPoints ??
            fund.nav_points ??
            [];

        for (const point of navPoints) {
            await client.query(
                `INSERT INTO fund_nav (fund_id, date, nav)
         VALUES ($1, $2, $3)
         ON CONFLICT (fund_id, date) DO UPDATE SET nav = EXCLUDED.nav`,
                [fund.id, point.date, Number(point.nav)]
            );
        }
    }
    console.log(`✓ Funds: ${funds.length} funds + NAV history inserted`);
}

// Step 4: Ingest holdings.json
async function ingestHoldings(client: any) {
    const holdings = loadJson<any[]>("holdings.json");

    for (const h of holdings) {
        // Some snapshots may not have a separate id field — use fund_id as fallback
        const id = h.id ?? `holding_${h.fund_id}`;

        await client.query(
            `INSERT INTO holdings (id, fund_id, fund_name, units, purchase_date, purchase_nav)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
            [
                id,
                h.fund_id,
                h.fund_name,
                Number(h.units),
                h.purchase_date,
                Number(h.purchase_nav),
            ]
        );
    }
    console.log(`✓ Holdings: ${holdings.length} rows inserted`);
}

// Main
async function main() {
    const client = await pool.connect();
    try {
        console.log(`\n📂 Ingesting from: ${path.resolve(DATA_DIR!)}\n`);

        await client.query("BEGIN");
        await clearTables(client);
        await ingestTransactions(client);
        await ingestFunds(client);
        await ingestHoldings(client);
        await client.query("COMMIT");

        console.log("\n✅ Ingest complete!\n");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("\n❌ Ingest failed (rolled back):", err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();