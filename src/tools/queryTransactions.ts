import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

export const queryTransactions = createTool({
    id: "query_transactions",
    description: "Query user transactions. Use mode=total for sum, mode=list for rows, mode=top_merchants for ranking, mode=monthly for month breakdown, mode=recurring for subscriptions.",
    inputSchema: z.object({
        mode: z.enum(["total", "list", "top_merchants", "monthly", "recurring"]).describe("What to return"),
        startDate: z.string().describe("Start date YYYY-MM-DD or empty string for all time"),
        endDate: z.string().describe("End date YYYY-MM-DD or empty string for all time"),
        category: z.string().describe("Filter by category, empty string means all categories"),
        merchant: z.string().describe("Filter by merchant partial name, empty string means all merchants"),
        limit: z.number().describe("Max results to return, use 10 as default"),
    }),

    execute: async (input) => {
        const { mode, startDate, endDate, category, merchant, limit } = input;

        try {
            const conditions: string[] = [];
            const params: any[] = [];
            let p = 1;

            // Always exclude transfers
            conditions.push(`LOWER(category) != 'transfer'`);

            if (startDate && startDate.trim() !== "") {
                conditions.push(`date >= $${p++}`);
                params.push(startDate.trim());
            }
            if (endDate && endDate.trim() !== "") {
                conditions.push(`date <= $${p++}`);
                params.push(endDate.trim());
            }
            if (category && category.trim() !== "") {
                conditions.push(`LOWER(category) = LOWER($${p++})`);
                params.push(category.trim());
            }
            if (merchant && merchant.trim() !== "") {
                conditions.push(`LOWER(merchant) LIKE LOWER($${p++})`);
                params.push(`%${merchant.trim()}%`);
            }

            const where = `WHERE ${conditions.join(" AND ")}`;
            const safeLimit = limit && limit > 0 ? limit : 10;

            // MODE: total
            if (mode === "total") {
                const result = await pool.query(`
          SELECT
            COALESCE(SUM(amount), 0) as total,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
            COUNT(*) as count
          FROM transactions ${where}
        `, params);
                const r = result.rows[0];
                return {
                    netSpend: Number(Number(r.total).toFixed(2)),
                    grossSpend: Number(Number(r.gross_spend).toFixed(2)),
                    refunds: Number(Number(r.refunds).toFixed(2)),
                    transactionCount: Number(r.count),
                };
            }

            // MODE: list
            if (mode === "list") {
                const result = await pool.query(`
          SELECT id, date, merchant, category, amount, memo
          FROM transactions ${where}
          ORDER BY date DESC LIMIT $${p}
        `, [...params, safeLimit]);
                return { transactions: result.rows };
            }

            // MODE: top_merchants
            if (mode === "top_merchants") {
                const result = await pool.query(`
          SELECT
            merchant,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as gross_spend,
            SUM(amount) as net_spend,
            COUNT(*) as count
          FROM transactions ${where}
          GROUP BY merchant
          ORDER BY gross_spend DESC
          LIMIT $${p}
        `, [...params, safeLimit]);
                return {
                    merchants: result.rows.map((r, i) => ({
                        rank: i + 1,
                        merchant: r.merchant,
                        grossSpend: Number(Number(r.gross_spend).toFixed(2)),
                        netSpend: Number(Number(r.net_spend).toFixed(2)),
                        count: Number(r.count),
                    })),
                };
            }

            // MODE: monthly
            if (mode === "monthly") {
                const result = await pool.query(`
          SELECT
            TO_CHAR(date, 'YYYY-MM') as month,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as gross_spend,
            SUM(amount) as net_spend,
            COUNT(*) as count
          FROM transactions ${where}
          GROUP BY TO_CHAR(date, 'YYYY-MM')
          ORDER BY month ASC
        `, params);
                return {
                    monthly: result.rows.map((r) => ({
                        month: r.month,
                        grossSpend: Number(Number(r.gross_spend).toFixed(2)),
                        netSpend: Number(Number(r.net_spend).toFixed(2)),
                        count: Number(r.count),
                    })),
                };
            }

            // MODE: recurring
            if (mode === "recurring") {
                const result = await pool.query(`
          SELECT
            merchant,
            category,
            COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) as months_active,
            COUNT(*) as total_txns,
            ROUND(AVG(amount)::numeric, 2) as avg_amount
          FROM transactions ${where}
          GROUP BY merchant, category
          HAVING COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) >= 3
          ORDER BY months_active DESC
          LIMIT $${p}
        `, [...params, safeLimit]);
                return {
                    recurringMerchants: result.rows.map((r) => ({
                        merchant: r.merchant,
                        category: r.category,
                        monthsActive: Number(r.months_active),
                        totalTransactions: Number(r.total_txns),
                        avgAmount: Number(r.avg_amount),
                    })),
                };
            }

            return { error: "Invalid mode" };

        } catch (err: any) {
            return { error: `DB error: ${err.message}` };
        }
    },
});