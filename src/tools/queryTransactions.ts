import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

export const queryTransactions = createTool({
    id: "query_transactions",
    description: "Query user transactions. mode=total for sum, mode=top_merchants for net spend ranking, mode=monthly for month breakdown, mode=recurring for subscriptions, mode=compare for two categories.",
    inputSchema: z.object({
        mode: z.enum(["total", "top_merchants", "monthly", "recurring", "compare"]),
        startDate: z.string(),
        endDate: z.string(),
        category: z.string(),
        merchant: z.string(),
        merchantVariants: z.string(),
        limit: z.number(),
        categoryB: z.string(),
    }),

    execute: async ({
        mode,
        startDate = "",
        endDate = "",
        category = "",
        merchant = "",
        merchantVariants = "",
        limit = 10,
        categoryB = "",
    }) => {

        try {
            const conditions: string[] = [];
            const params: any[] = [];
            let p = 1;

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

            // Prefer exact variants over fuzzy
            if (merchantVariants && merchantVariants.trim() !== "") {
                const variants = merchantVariants.split(",").map((v) => v.trim()).filter(Boolean);
                if (variants.length > 0) {
                    const placeholders = variants.map(() => `$${p++}`).join(", ");
                    conditions.push(`merchant IN (${placeholders})`);
                    params.push(...variants);
                }
            } else if (merchant && merchant.trim() !== "") {
                conditions.push(`LOWER(merchant) LIKE LOWER($${p++})`);
                params.push(`%${merchant.trim()}%`);
            }

            const where = `WHERE ${conditions.join(" AND ")}`;
            const safeLimit = (limit && limit > 0) ? limit : 10;

            // total
            if (mode === "total") {
                const result = await pool.query(`
          SELECT
            COALESCE(SUM(amount), 0) as net_spend,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
            COUNT(*) as count,
            MIN(date) as earliest_date,
            MAX(date) as latest_date
          FROM transactions ${where}
        `, params);
                const r = result.rows[0];
                if (Number(r.count) === 0) {
                    return { noData: true, message: "No transactions found for the given filters.", netSpend: 0, grossSpend: 0, refunds: 0, transactionCount: 0 };
                }
                return {
                    noData: false,
                    netSpend: Number(Number(r.net_spend).toFixed(2)),
                    grossSpend: Number(Number(r.gross_spend).toFixed(2)),
                    refunds: Number(Number(r.refunds).toFixed(2)),
                    transactionCount: Number(r.count),
                    dateRange: { from: r.earliest_date, to: r.latest_date },
                };
            }

            // top_merchants ranked by NET spend
            if (mode === "top_merchants") {
                const result = await pool.query(`
          SELECT
            merchant,
            COALESCE(SUM(amount), 0) as net_spend,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
            COUNT(*) as count
          FROM transactions ${where}
          GROUP BY merchant
          ORDER BY net_spend DESC
          LIMIT $${p}
        `, [...params, safeLimit]);
                if (result.rows.length === 0) {
                    return { noData: true, message: "No transactions found.", merchants: [] };
                }
                return {
                    noData: false,
                    merchants: result.rows.map((r, i) => ({
                        rank: i + 1,
                        merchant: r.merchant,
                        netSpend: Number(Number(r.net_spend).toFixed(2)),
                        grossSpend: Number(Number(r.gross_spend).toFixed(2)),
                        refunds: Number(Number(r.refunds).toFixed(2)),
                        transactionCount: Number(r.count),
                    })),
                };
            }

            // monthly
            if (mode === "monthly") {
                const result = await pool.query(`
          SELECT
            TO_CHAR(date, 'YYYY-MM') as month,
            COALESCE(SUM(amount), 0) as net_spend,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
            COUNT(*) as count
          FROM transactions ${where}
          GROUP BY TO_CHAR(date, 'YYYY-MM')
          ORDER BY month ASC
        `, params);
                if (result.rows.length === 0) {
                    return { noData: true, message: "No transactions found.", monthly: [] };
                }
                return {
                    noData: false,
                    monthly: result.rows.map((r) => ({
                        month: r.month,
                        netSpend: Number(Number(r.net_spend).toFixed(2)),
                        grossSpend: Number(Number(r.gross_spend).toFixed(2)),
                        refunds: Number(Number(r.refunds).toFixed(2)),
                        transactionCount: Number(r.count),
                    })),
                };
            }

            // recurring with confidence scoring
            if (mode === "recurring") {
                const result = await pool.query(`
          SELECT
            merchant,
            category,
            COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) as months_active,
            COUNT(*) as total_txns,
            ROUND(AVG(amount)::numeric, 2) as avg_amount,
            COALESCE(ROUND(STDDEV(amount)::numeric, 2), 0) as stddev_amount,
            ROUND(AVG(EXTRACT(DAY FROM date))::numeric, 1) as avg_day,
            COALESCE(ROUND(STDDEV(EXTRACT(DAY FROM date))::numeric, 1), 0) as stddev_day
          FROM transactions ${where}
          GROUP BY merchant, category
          HAVING COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) >= 2
          ORDER BY months_active DESC
          LIMIT $${p}
        `, [...params, safeLimit]);
                if (result.rows.length === 0) {
                    return { noData: true, message: "No recurring merchants found.", recurringMerchants: [] };
                }
                return {
                    noData: false,
                    recurringMerchants: result.rows.map((r) => {
                        const months = Number(r.months_active);
                        const stddevAmt = Number(r.stddev_amount);
                        const stddevDay = Number(r.stddev_day);
                        let confidence = "low";
                        if (months >= 6 && stddevAmt < 5 && stddevDay < 5) confidence = "high";
                        else if (months >= 3 && stddevAmt < 50) confidence = "medium";
                        return {
                            merchant: r.merchant,
                            category: r.category,
                            monthsActive: months,
                            totalTransactions: Number(r.total_txns),
                            avgAmount: Number(r.avg_amount),
                            confidence,
                            isLikelySubscription: confidence !== "low",
                        };
                    }),
                };
            }

            // compare — math done in code not model
            if (mode === "compare") {
                const catA = category.trim();
                const catB = categoryB.trim();
                if (!catA || !catB) return { error: "compare needs category and categoryB both filled" };

                const dateConditions: string[] = [];
                const dateParams: any[] = [];
                let dp = 1;
                if (startDate && startDate.trim() !== "") { dateConditions.push(`date >= $${dp++}`); dateParams.push(startDate.trim()); }
                if (endDate && endDate.trim() !== "") { dateConditions.push(`date <= $${dp++}`); dateParams.push(endDate.trim()); }
                const dateWhere = dateConditions.length > 0 ? `AND ${dateConditions.join(" AND ")}` : "";

                const result = await pool.query(`
          SELECT
            TO_CHAR(date, 'YYYY-MM') as month,
            LOWER(category) as cat,
            COALESCE(SUM(amount), 0) as net_spend
          FROM transactions
          WHERE LOWER(category) IN (LOWER($${dp}), LOWER($${dp + 1}))
          AND LOWER(category) != 'transfer'
          ${dateWhere}
          GROUP BY TO_CHAR(date, 'YYYY-MM'), LOWER(category)
          ORDER BY month ASC
        `, [...dateParams, catA, catB]);

                if (result.rows.length === 0) {
                    return { noData: true, message: `No data found for ${catA} or ${catB}`, comparison: [] };
                }

                const catALow = catA.toLowerCase();
                const catBLow = catB.toLowerCase();
                const monthMap: Record<string, any> = {};
                for (const row of result.rows) {
                    if (!monthMap[row.month]) monthMap[row.month] = { month: row.month, [catALow]: 0, [catBLow]: 0 };
                    monthMap[row.month][row.cat] = Number(Number(row.net_spend).toFixed(2));
                }

                const comparison = Object.values(monthMap).map((m: any) => ({
                    ...m,
                    difference: Number((m[catALow] - m[catBLow]).toFixed(2)),
                }));

                const active = comparison.filter((m) => m[catALow] > 0 && m[catBLow] > 0);
                let growthSummary = "Not enough data to compute growth.";
                if (active.length >= 2) {
                    const first = active[0];
                    const last = active[active.length - 1];
                    const gA = first[catALow] > 0 ? ((last[catALow] - first[catALow]) / first[catALow] * 100).toFixed(1) : "0";
                    const gB = first[catBLow] > 0 ? ((last[catBLow] - first[catBLow]) / first[catBLow] * 100).toFixed(1) : "0";
                    const faster = Number(gA) > Number(gB) ? catA : catB;
                    growthSummary = `${faster} grew faster. ${catA}: ${gA}% growth, ${catB}: ${gB}% growth (${first.month} to ${last.month}).`;
                }

                return { noData: false, categoryA: catA, categoryB: catB, comparison, growthSummary };
            }

            return { error: "Invalid mode" };
        } catch (err: any) {
            return { error: `DB error: ${err.message}` };
        }
    },
});