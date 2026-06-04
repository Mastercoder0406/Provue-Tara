// scripts/eval.ts
// Run with: npx tsx scripts/eval.ts
// Make sure server is running first: npm start

import * as dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.EVAL_URL ?? "http://localhost:3000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvalQuestion {
    id: string;
    category: string;
    question: string;
    check: (answer: string) => boolean;
    hint: string; // what a correct answer should contain
}

interface EvalResult {
    id: string;
    category: string;
    question: string;
    answer: string;
    passed: boolean;
    hint: string;
    latencyMs: number;
    error?: string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function containsAny(answer: string, keywords: string[]): boolean {
    const lower = answer.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
}

function containsNumber(answer: string): boolean {
    return /[\d,]+(\.\d+)?/.test(answer);
}

function doesNotContain(answer: string, keywords: string[]): boolean {
    const lower = answer.toLowerCase();
    return !keywords.some((k) => lower.includes(k.toLowerCase()));
}

// ─── Eval Questions (12 minimum as required) ─────────────────────────────────

const questions: EvalQuestion[] = [
    // 1. Single lookup — total spend
    {
        id: "Q01",
        category: "Single Lookup",
        question: "How much did I spend in total across all transactions?",
        check: (a) => containsNumber(a) && containsAny(a, ["total", "spent", "spend", "₹", "inr", "rs"]),
        hint: "Should contain a total amount number",
    },

    // 2. Date filtering — specific month
    {
        id: "Q02",
        category: "Date Filtering",
        question: "How much did I spend in January 2025?",
        check: (a) => containsNumber(a) && containsAny(a, ["january", "jan", "2025"]),
        hint: "Should mention January 2025 and a number",
    },

    // 3. Date filtering — Q1
    {
        id: "Q03",
        category: "Date Filtering",
        question: "What was my total spending in Q1 2025 excluding transfers?",
        check: (a) => containsNumber(a) && containsAny(a, ["2025", "quarter", "q1", "january", "march"]),
        hint: "Should mention Q1 2025 and a number",
    },

    // 4. Refunds — net spend
    {
        id: "Q04",
        category: "Refunds",
        question: "How much did I spend on food in March 2025 after accounting for refunds?",
        check: (a) => containsNumber(a) && containsAny(a, ["food", "march", "refund", "net"]),
        hint: "Should mention food, March, and handle refunds",
    },

    // 5. Merchant aliases — Swiggy
    {
        id: "Q05",
        category: "Merchant Aliases",
        question: "How much did I spend on Swiggy in total including all Swiggy variants?",
        check: (a) => containsNumber(a) && containsAny(a, ["swiggy"]),
        hint: "Should mention Swiggy and show a combined total",
    },

    // 6. Top merchants
    {
        id: "Q06",
        category: "Top Merchants",
        question: "What are my top 5 merchants by spending?",
        check: (a) => containsNumber(a) && (a.includes("1.") || a.includes("1)") || containsAny(a, ["top", "highest", "most"])),
        hint: "Should list top merchants with amounts",
    },

    // 7. Transfers — excluded
    {
        id: "Q07",
        category: "Transfers",
        question: "What is my actual total spending in 2025 ignoring internal transfers?",
        check: (a) => containsNumber(a) && doesNotContain(a, ["error", "failed"]),
        hint: "Should return a number excluding transfers",
    },

    // 8. Category comparison
    {
        id: "Q08",
        category: "Category Comparison",
        question: "Compare my food and travel spending month by month. Which grew faster?",
        check: (a) => containsAny(a, ["food", "travel"]) && containsNumber(a),
        hint: "Should compare food vs travel with numbers",
    },

    // 9. Recurring subscriptions
    {
        id: "Q09",
        category: "Recurring Subscriptions",
        question: "Which merchants look like recurring subscriptions based on my transactions?",
        check: (a) => containsAny(a, ["recurring", "subscription", "monthly", "regular", "every month"]) || containsNumber(a),
        hint: "Should identify recurring/subscription merchants",
    },

    // 10. No data case
    {
        id: "Q10",
        category: "No Data Case",
        question: "How much did I spend on rent in April 2025?",
        check: (a) =>
            containsAny(a, [
                "no data",
                "don't have",
                "do not have",
                "not found",
                "no transactions",
                "no records",
                "0",
                "zero",
                "nothing",
                "april 2025",
            ]),
        hint: "Should honestly say no data or return zero",
    },

    // 11. Fund period return
    {
        id: "Q11",
        category: "Fund Period Return",
        question: "What returns did my mutual funds give between 2024-01-01 and 2025-01-01?",
        check: (a) => containsNumber(a) && containsAny(a, ["fund", "return", "nav", "%", "percent"]),
        hint: "Should show fund returns with percentages",
    },

    // 12. Holding realised return
    {
        id: "Q12",
        category: "Holding Realised Return",
        question: "What is my portfolio worth today and how much have I made on it?",
        check: (a) => containsNumber(a) && containsAny(a, ["portfolio", "worth", "value", "return", "made", "profit", "₹", "inr"]),
        hint: "Should show portfolio value and total return",
    },

    // BONUS 13 — Rank funds
    {
        id: "Q13",
        category: "Fund Ranking",
        question: "Rank all my funds by their one year return from 2024-01-01 to 2025-01-01",
        check: (a) => containsNumber(a) && containsAny(a, ["fund", "return", "%", "rank", "best", "1.", "1)"]),
        hint: "Should rank funds with return percentages",
    },

    // BONUS 14 — Specific holding return
    {
        id: "Q14",
        category: "Holding Realised Return",
        question: "Which of my fund holdings gave me the best realised return?",
        check: (a) => containsNumber(a) && containsAny(a, ["fund", "return", "%", "best", "highest"]),
        hint: "Should identify best performing holding",
    },

    // BONUS 15 — Month over month
    {
        id: "Q15",
        category: "Month Over Month",
        question: "Did my food spending increase or decrease from February 2025 to March 2025?",
        check: (a) =>
            containsNumber(a) &&
            containsAny(a, ["food", "february", "march", "increase", "decrease", "more", "less", "higher", "lower"]),
        hint: "Should compare food spend Feb vs March 2025",
    },
];

// ─── Ask function ─────────────────────────────────────────────────────────────

async function askTara(question: string): Promise<{ answer: string; latencyMs: number }> {
    const start = Date.now();
    const response = await fetch(`${BASE_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
    });

    const latencyMs = Date.now() - start;
    const data = await response.json() as any;

    if (!response.ok) {
        throw new Error(data.error ?? data.details ?? "Unknown error");
    }

    return { answer: data.answer ?? "", latencyMs };
}

// ─── Main eval runner ─────────────────────────────────────────────────────────

async function runEval() {
    console.log("\n");
    console.log("=".repeat(60));
    console.log("  TARA EVAL SUITE");
    console.log(`  Target: ${BASE_URL}`);
    console.log(`  Questions: ${questions.length}`);
    console.log(`  Time: ${new Date().toISOString()}`);
    console.log("=".repeat(60));
    console.log("\n");

    const results: EvalResult[] = [];

    for (const q of questions) {
        process.stdout.write(`[${q.id}] ${q.category} — ${q.question.slice(0, 50)}...`);

        try {
            const { answer, latencyMs } = await askTara(q.question);
            const passed = q.check(answer);

            results.push({
                id: q.id,
                category: q.category,
                question: q.question,
                answer,
                passed,
                hint: q.hint,
                latencyMs,
            });

            console.log(passed ? `  ✅ PASS (${latencyMs}ms)` : `  ❌ FAIL (${latencyMs}ms)`);

        } catch (err: any) {
            results.push({
                id: q.id,
                category: q.category,
                question: q.question,
                answer: "",
                passed: false,
                hint: q.hint,
                latencyMs: 0,
                error: err.message,
            });
            console.log(`  💥 ERROR — ${err.message.slice(0, 60)}`);
        }

        // Small delay between questions to avoid rate limits
        await new Promise((r) => setTimeout(r, 2000));
    }

    // ─── Summary ────────────────────────────────────────────────────────────────

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const errors = results.filter((r) => r.error).length;
    const avgLatency = Math.round(
        results.filter((r) => r.latencyMs > 0).reduce((s, r) => s + r.latencyMs, 0) /
        results.filter((r) => r.latencyMs > 0).length
    );

    console.log("\n");
    console.log("=".repeat(60));
    console.log("  RESULTS SUMMARY");
    console.log("=".repeat(60));
    console.log(`  Total    : ${results.length}`);
    console.log(`  Passed   : ${passed} ✅`);
    console.log(`  Failed   : ${failed} ❌`);
    console.log(`  Errors   : ${errors} 💥`);
    console.log(`  Avg time : ${avgLatency}ms`);
    console.log(`  Score    : ${Math.round((passed / results.length) * 100)}%`);
    console.log("=".repeat(60));

    // ─── Failed cases detail ─────────────────────────────────────────────────────

    const failedResults = results.filter((r) => !r.passed);
    if (failedResults.length > 0) {
        console.log("\n  FAILED CASES:\n");
        for (const r of failedResults) {
            console.log(`  [${r.id}] ${r.category}`);
            console.log(`  Question : ${r.question}`);
            console.log(`  Expected : ${r.hint}`);
            if (r.error) {
                console.log(`  Error    : ${r.error}`);
            } else {
                console.log(`  Got      : ${r.answer.slice(0, 150)}...`);
            }
            console.log("");
        }
    }

    console.log("=".repeat(60));
    console.log("\n");

    // Exit with error code if more than half failed
    if (passed < results.length / 2) {
        process.exit(1);
    }
}

runEval().catch((err) => {
    console.error("Eval crashed:", err);
    process.exit(1);
});