// src/server.ts
// Full server with observability — logs every request in detail

import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { tara } from "./agent";

dotenv.config();

const app = express();
app.use(express.json());

// ─── Log file setup ───────────────────────────────────────────────────────────

const LOG_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_FILE = path.join(LOG_DIR, "tara.log");

function writeLog(data: object) {
    const line = JSON.stringify(data) + "\n";
    // Write to file
    fs.appendFileSync(LOG_FILE, line);
    // Also print to console (pretty)
    console.log(JSON.stringify(data, null, 2));
}

// ─── Generate simple request ID ──────────────────────────────────────────────

function makeRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── POST /ask ────────────────────────────────────────────────────────────────

app.post("/ask", async (req: any, res: any) => {
    const requestId = makeRequestId();
    const startTime = Date.now();
    const { question } = req.body;

    // ── Validate input ──────────────────────────────────────────────────────────
    if (!question || typeof question !== "string" || question.trim() === "") {
        writeLog({
            requestId,
            timestamp: new Date().toISOString(),
            event: "validation_error",
            error: "Missing or empty question field",
            status: "error",
        });
        return res.status(400).json({ error: "Missing or empty 'question' field" });
    }

    const cleanQuestion = question.trim();

    // ── Log incoming request ────────────────────────────────────────────────────
    writeLog({
        requestId,
        timestamp: new Date().toISOString(),
        event: "request_received",
        question: cleanQuestion,
    });

    try {
        // ── Run Tara agent ────────────────────────────────────────────────────────
        const result = await tara.generate(cleanQuestion);

        const latencyMs = Date.now() - startTime;

        // ── Extract tool usage info ───────────────────────────────────────────────
        const toolsUsed: string[] = [];
        const toolInputs: any[] = [];
        const tablesRead: string[] = [];

        if (result.toolResults && Array.isArray(result.toolResults)) {
            for (const tr of result.toolResults) {
                const toolName = (tr as any).toolName ?? (tr as any).tool ?? (tr as any).type ?? "unknown";
                toolsUsed.push(toolName);

                const safeInput = (tr as any).input ?? (tr as any).args ?? (tr as any).result ?? {};
                toolInputs.push({ tool: toolName, input: safeInput });

                // Infer which DB tables were read from tool name
                if (toolName === "query_transactions") tablesRead.push("transactions");
                if (toolName === "get_merchant_aliases") tablesRead.push("transactions");
                if (toolName === "get_fund_returns") tablesRead.push("funds", "fund_nav");
                if (toolName === "get_holding_returns") tablesRead.push("holdings", "fund_nav");
            }
        }

        // Deduplicate tables
        const uniqueTables = [...new Set(tablesRead)];

        // ── Log success ───────────────────────────────────────────────────────────
        writeLog({
            requestId,
            timestamp: new Date().toISOString(),
            event: "request_completed",
            question: cleanQuestion,
            answer: result.text,
            toolsUsed,
            toolInputs,
            tablesRead: uniqueTables,
            latencyMs,
            status: "success",
        });

        return res.json({ answer: result.text });

    } catch (err: any) {
        const latencyMs = Date.now() - startTime;

        // ── Log failure ───────────────────────────────────────────────────────────
        writeLog({
            requestId,
            timestamp: new Date().toISOString(),
            event: "request_failed",
            question: cleanQuestion,
            error: err.message,
            latencyMs,
            status: "error",
            fallbackReason: err.message,
        });

        return res.status(500).json({
            error: "Agent failed to process the question",
            details: err.message,
        });
    }
});

// ─── GET /health ──────────────────────────────────────────────────────────────

app.get("/health", (_req: any, res: any) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        logFile: LOG_FILE,
    });
});

// ─── GET /logs ────────────────────────────────────────────────────────────────
// Shows last 20 log entries — useful for checking what happened

app.get("/logs", (_req: any, res: any) => {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            return res.json({ logs: [], message: "No logs yet" });
        }

        const lines = fs
            .readFileSync(LOG_FILE, "utf-8")
            .split("\n")
            .filter(Boolean)
            .slice(-20) // last 20 entries
            .map((line) => {
                try { return JSON.parse(line); }
                catch { return { raw: line }; }
            });

        return res.json({ logs: lines, count: lines.length });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
    console.log("\n" + "=".repeat(50));
    console.log("  🤖 TARA is running");
    console.log("=".repeat(50));
    console.log(`  POST  http://localhost:${PORT}/ask`);
    console.log(`  GET   http://localhost:${PORT}/health`);
    console.log(`  GET   http://localhost:${PORT}/logs`);
    console.log(`  Logs  ${LOG_FILE}`);
    console.log("=".repeat(50) + "\n");
});