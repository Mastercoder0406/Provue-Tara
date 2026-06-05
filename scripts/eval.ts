import * as dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.EVAL_URL ?? "http://localhost:3000";
const DELAY_MS = 10000; // 10 seconds — avoids Groq rate limit

interface Q { id: string; cat: string; q: string; check: (a: string) => boolean; hint: string; }

const has = (a: string, kw: string[]) => kw.some((k) => a.toLowerCase().includes(k.toLowerCase()));
const hasNum = (a: string) => /[\d,]+(\.\d+)?/.test(a);

const questions: Q[] = [
    { id: "Q01", cat: "Single Lookup", q: "How much did I spend in total across all transactions?", check: (a) => hasNum(a) && has(a, ["total", "spent", "spend", "₹", "inr"]), hint: "Total amount number" },
    { id: "Q02", cat: "Date Filter", q: "How much did I spend in January 2025?", check: (a) => hasNum(a) && has(a, ["january", "jan", "2025"]), hint: "January 2025 + number" },
    { id: "Q03", cat: "Date Filter", q: "What was my total spending in Q1 2025 excluding transfers?", check: (a) => hasNum(a) && has(a, ["2025", "q1", "january", "march", "quarter"]), hint: "Q1 2025 + number" },
    { id: "Q04", cat: "Refunds", q: "How much did I spend on food in March 2025 after accounting for refunds?", check: (a) => hasNum(a) && has(a, ["food", "march", "refund", "net"]), hint: "food + March + refund" },
    { id: "Q05", cat: "Merchant Alias", q: "How much did I spend on Swiggy in total including all Swiggy variants?", check: (a) => hasNum(a) && has(a, ["swiggy"]), hint: "Swiggy + combined total" },
    { id: "Q06", cat: "Top Merchants", q: "What are my top 5 merchants by spending?", check: (a) => hasNum(a), hint: "List of merchants with amounts" },
    { id: "Q07", cat: "Transfers", q: "What is my actual total spending in 2025 ignoring transfers?", check: (a) => hasNum(a) && !has(a, ["error", "failed"]), hint: "Number without transfers" },
    { id: "Q08", cat: "Comparison", q: "Compare my food and travel spending month by month. Which grew faster?", check: (a) => has(a, ["food", "travel"]) && hasNum(a), hint: "food vs travel with numbers" },
    { id: "Q09", cat: "Recurring", q: "Which merchants look like recurring subscriptions?", check: (a) => has(a, ["recurring", "subscription", "monthly", "regular"]) || hasNum(a), hint: "Recurring merchants" },
    { id: "Q10", cat: "No Data", q: "How much did I spend on rent in April 2025?", check: (a) => has(a, ["no data", "don't have", "do not have", "not found", "0", "zero", "nothing", "april"]), hint: "No data or zero" },
    { id: "Q11", cat: "Fund Return", q: "What returns did my mutual funds give between 2024-01-01 and 2025-01-01?", check: (a) => hasNum(a) && has(a, ["fund", "return", "%", "percent"]), hint: "Fund returns with %" },
    { id: "Q12", cat: "Portfolio", q: "What is my portfolio worth today and how much have I made on it?", check: (a) => hasNum(a) && has(a, ["portfolio", "worth", "value", "return", "made", "₹"]), hint: "Portfolio value + return" },
    { id: "Q13", cat: "Fund Ranking", q: "Rank all my funds by one year return from 2024-01-01 to 2025-01-01", check: (a) => hasNum(a) && has(a, ["fund", "return", "%"]), hint: "Ranked funds with %" },
    { id: "Q14", cat: "Best Holding", q: "Which of my fund holdings gave me the best realised return?", check: (a) => hasNum(a) && has(a, ["fund", "return", "%", "best", "highest"]), hint: "Best holding + %" },
    { id: "Q15", cat: "Month-on-Month", q: "Did my food spending increase or decrease from February 2025 to March 2025?", check: (a) => hasNum(a) && has(a, ["food", "february", "march", "increase", "decrease", "more", "less"]), hint: "Feb vs March food" },
];

async function ask(q: string) {
    const start = Date.now();
    const res = await fetch(`${BASE_URL}/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q })
    });
    const ms = Date.now() - start;
    const data = await res.json() as any;
    if (!res.ok) throw new Error(data.error ?? data.details ?? "error");
    return { answer: data.answer ?? "", ms };
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
    console.log(`\n${"=".repeat(60)}\n  TARA EVAL → ${BASE_URL}\n  ${questions.length} questions | ${DELAY_MS / 1000}s delay between each\n${"=".repeat(60)}\n`);

    const results: any[] = [];

    for (const q of questions) {
        process.stdout.write(`[${q.id}] ${q.q.slice(0, 55)}... `);
        try {
            const { answer, ms } = await ask(q.q);
            const passed = q.check(answer);
            results.push({ ...q, answer, passed, ms });
            console.log(passed ? `✅ (${ms}ms)` : `❌ (${ms}ms)`);
        } catch (err: any) {
            results.push({ ...q, answer: "", passed: false, ms: 0, error: err.message });
            console.log(`💥 ${err.message.slice(0, 60)}`);
        }
        if (q !== questions[questions.length - 1]) await sleep(DELAY_MS);
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    const avgMs = Math.round(results.filter((r) => r.ms > 0).reduce((s, r) => s + r.ms, 0) / Math.max(1, results.filter((r) => r.ms > 0).length));

    console.log(`\n${"=".repeat(60)}\n  RESULTS\n${"=".repeat(60)}`);
    console.log(`  Total:${results.length} Passed:${passed}✅ Failed:${failed}❌ Avg:${avgMs}ms Score:${Math.round(passed / results.length * 100)}%`);
    console.log("=".repeat(60));

    const failedList = results.filter((r) => !r.passed);
    if (failedList.length > 0) {
        console.log("\n  FAILED CASES:\n");
        for (const r of failedList) {
            console.log(`  [${r.id}] ${r.q}`);
            console.log(`  Hint: ${r.hint}`);
            if (r.error) console.log(`  Error: ${r.error}`);
            else console.log(`  Got: ${r.answer.slice(0, 150)}`);
            console.log("");
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });