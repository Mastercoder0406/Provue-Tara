import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { tara } from "./agent";
import { pool } from "./db";

dotenv.config();

export const app = express();
app.use(express.json());

const LOG_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "tara.log");

function writeLog(data: object) {
    fs.appendFileSync(LOG_FILE, JSON.stringify(data) + "\n");
    console.log(JSON.stringify(data, null, 2));
}

function makeId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Extract tool names from Mastra result — tries every known location
function extractTools(result: any): { toolsUsed: string[]; toolInputs: any[]; tablesRead: string[] } {
    const toolsUsed: string[] = [];
    const toolInputs: any[] = [];
    const tablesRead: string[] = [];

    // Method 1: result.steps[].toolCalls[]
    const steps: any[] = result.steps ?? [];
    for (const step of steps) {
        for (const tc of (step.toolCalls ?? [])) {
            const name = tc.toolName ?? tc.name ?? "";
            if (name) {
                toolsUsed.push(name);
                toolInputs.push({ tool: name, input: tc.args ?? {} });
            }
        }
        // Also check step.toolResults
        for (const tr of (step.toolResults ?? [])) {
            const name = tr.toolName ?? tr.tool ?? "";
            if (name && !toolsUsed.includes(name)) toolsUsed.push(name);
        }
    }

    // Method 2: result.toolCalls[] (flat)
    for (const tc of (result.toolCalls ?? [])) {
        const name = tc.toolName ?? tc.name ?? "";
        if (name && !toolsUsed.includes(name)) {
            toolsUsed.push(name);
            toolInputs.push({ tool: name, input: tc.args ?? {} });
        }
    }

    // Method 3: result.toolResults[] (flat)
    for (const tr of (result.toolResults ?? [])) {
        const name = tr.toolName ?? tr.tool ?? "";
        if (name && !toolsUsed.includes(name)) toolsUsed.push(name);
    }

    // Infer tables from tool names
    for (const name of toolsUsed) {
        if (name === "query_transactions" || name === "get_merchant_aliases") tablesRead.push("transactions");
        if (name === "get_fund_returns") { tablesRead.push("funds"); tablesRead.push("fund_nav"); }
        if (name === "get_holding_returns") { tablesRead.push("holdings"); tablesRead.push("fund_nav"); }
    }

    return {
        toolsUsed: [...new Set(toolsUsed)],
        toolInputs,
        tablesRead: [...new Set(tablesRead)],
    };
}

app.post("/ask", async (req: any, res: any) => {
    const requestId = makeId();
    const startTime = Date.now();
    const { question } = req.body;

    if (!question || typeof question !== "string" || question.trim() === "") {
        return res.status(400).json({ error: "Missing question field" });
    }

    const q = question.trim();
    writeLog({ requestId, timestamp: new Date().toISOString(), event: "request_received", question: q });

    try {
        const result = await tara.generate(q);
        const latencyMs = Date.now() - startTime;
        const { toolsUsed, toolInputs, tablesRead } = extractTools(result);

        writeLog({
            requestId,
            timestamp: new Date().toISOString(),
            event: "request_completed",
            question: q,
            answer: result.text,
            toolsUsed,
            toolInputs,
            tablesRead,
            latencyMs,
            status: "success",
        });

        return res.json({ answer: result.text });

    } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        writeLog({
            requestId,
            timestamp: new Date().toISOString(),
            event: "request_failed",
            question: q,
            error: err.message,
            latencyMs,
            status: "error",
        });
        return res.status(500).json({ error: "Agent failed", details: err.message });
    }
});


// Landing page
app.get("/", (_req: any, res: any) => {
    res.sendFile(path.join(process.cwd(), "src", "landing.html"));
});

app.get("/health", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/logs", (_req: any, res: any) => {
    try {
        if (!fs.existsSync(LOG_FILE)) return res.json({ logs: [], message: "No logs yet" });
        const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean)
            .slice(-20).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
        return res.json({ logs: lines, count: lines.length });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/debug-db", async (_req, res) => {
    const tx = await pool.query(
        "SELECT COUNT(*) count FROM transactions"
    );

    res.json({
        databaseUrl: process.env.DATABASE_URL?.slice(0, 50),
        transactionCount: tx.rows[0].count,
    });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
    console.log(`\n${"=".repeat(50)}\n  TARA running → http://localhost:${PORT}\n${"=".repeat(50)}\n`);
});