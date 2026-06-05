import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

type ToolArgs = {
    mode?: "total" | "top_merchants" | "monthly" | "recurring" | "compare";
    startDate?: string;
    endDate?: string;
    category?: string;
    merchant?: string;
    merchantVariants?: string;
    limit?: number;
    categoryB?: string;
};

function cleanString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown, fallback = 10): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function splitVariants(value: string): string[] {
    return value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
}

function formatMoney(value: number): string {
    return value.toFixed(2);
}

function buildAnswerTopMerchants(
    merchants: Array<{
        rank: number;
        merchant: string;
        netSpend: number;
        grossSpend: number;
        refunds: number;
        transactionCount: number;
    }>
): string {
    const lines = merchants.map(
        (m) => `${m.rank}. ${m.merchant} - ₹${formatMoney(m.netSpend)}`
    );
    return `Here are your top ${merchants.length} merchants by net spend:\n\n${lines.join(
        "\n"
    )}`;
}

function buildAnswerTotal(netSpend: number, startDate: string, endDate: string): string {
    if (startDate && endDate) {
        return `Your total net spend from ${startDate} to ${endDate} was ₹${formatMoney(
            netSpend
        )}.`;
    }
    return `Your total net spend was ₹${formatMoney(netSpend)}.`;
}

export const queryTransactions = createTool({
    id: "query_transactions",
    description:
        "Query user transactions. Use mode=total for sum, mode=top_merchants for net spend ranking, mode=monthly for month breakdown, mode=recurring for subscriptions, mode=compare for two categories.",

    inputSchema: z.object({
        mode: z.enum(["total", "top_merchants", "monthly", "recurring", "compare"]),
        startDate: z.string().optional().default(""),
        endDate: z.string().optional().default(""),
        category: z.string().optional().default(""),
        merchant: z.string().optional().default(""),
        merchantVariants: z.string().optional().default(""),
        limit: z.number().optional().default(10),
        categoryB: z.string().optional().default(""),
    }),

    execute: async (input: any) => {
        try {
            const args: ToolArgs = input?.context ?? input ?? {};

            const mode = args.mode;
            const startDate = cleanString(args.startDate);
            const endDate = cleanString(args.endDate);
            const category = cleanString(args.category);
            const merchant = cleanString(args.merchant);
            const merchantVariants = cleanString(args.merchantVariants);
            const limit = cleanNumber(args.limit, 10);
            const categoryB = cleanString(args.categoryB);

            console.log(
                "QUERY TRANSACTION INPUT:",
                JSON.stringify({
                    mode,
                    startDate,
                    endDate,
                    category,
                    merchant,
                    merchantVariants,
                    limit,
                    categoryB,
                })
            );

            if (!mode) {
                return {
                    noData: true,
                    error: "mode is required",
                    answer: "No data found.",
                };
            }

            const baseConditions: string[] = [];
            const baseParams: any[] = [];
            let p = 1;

            // Exclude transfer-like categories more safely
            baseConditions.push(`LOWER(COALESCE(category, '')) NOT LIKE '%transfer%'`);

            if (startDate) {
                baseConditions.push(`date >= $${p++}`);
                baseParams.push(startDate);
            }

            if (endDate) {
                baseConditions.push(`date <= $${p++}`);
                baseParams.push(endDate);
            }

            if (category) {
                baseConditions.push(`LOWER(category) = LOWER($${p++})`);
                baseParams.push(category);
            }

            // Prefer aliases if provided
            if (merchantVariants) {
                const variants = splitVariants(merchantVariants).map((v) => v.toLowerCase());
                if (variants.length > 0) {
                    const placeholders = variants.map(() => `$${p++}`).join(", ");
                    baseConditions.push(`LOWER(COALESCE(merchant, '')) IN (${placeholders})`);
                    baseParams.push(...variants);
                }
            } else if (merchant) {
                baseConditions.push(`COALESCE(merchant, '') ILIKE $${p++}`);
                baseParams.push(`%${merchant}%`);
            }

            const whereClause =
                baseConditions.length > 0 ? `WHERE ${baseConditions.join(" AND ")}` : "";

            const safeLimit = limit > 0 ? limit : 10;

            // total
            if (mode === "total") {
                const result = await pool.query(
                    `
          SELECT
            COALESCE(SUM(amount), 0) as net_spend,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
            COUNT(*) as transaction_count,
            MIN(date) as earliest_date,
            MAX(date) as latest_date
          FROM transactions
          ${whereClause}
          `,
                    baseParams
                );

                const r = result.rows[0];
                const count = Number(r.transaction_count || 0);

                if (count === 0) {
                    return {
                        noData: true,
                        netSpend: 0,
                        grossSpend: 0,
                        refunds: 0,
                        transactionCount: 0,
                        answer: "No transactions found for the given filters.",
                    };
                }

                const netSpend = Number(r.net_spend || 0);
                const grossSpend = Number(r.gross_spend || 0);
                const refunds = Number(r.refunds || 0);

                return {
                    noData: false,
                    netSpend: Number(netSpend.toFixed(2)),
                    grossSpend: Number(grossSpend.toFixed(2)),
                    refunds: Number(refunds.toFixed(2)),
                    transactionCount: count,
                    dateRange: { from: r.earliest_date, to: r.latest_date },
                    answer: buildAnswerTotal(netSpend, startDate, endDate),
                };
            }

            // top_merchants
            if (mode === "top_merchants") {
                const query = `
          SELECT
            COALESCE(merchant, 'Unknown') as merchant,
            COALESCE(SUM(amount), 0) as net_spend,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
            COUNT(*) as transaction_count
          FROM transactions
          ${whereClause}
          GROUP BY COALESCE(merchant, 'Unknown')
          ORDER BY net_spend DESC, gross_spend DESC, merchant ASC
          LIMIT $${p}
        `;

                let result = await pool.query(query, [...baseParams, safeLimit]);

                // Fallback only if the strict filter produced nothing
                // This protects against category-shape differences in deployed snapshots.
                if (result.rows.length === 0 && !startDate && !endDate && !category && !merchant && !merchantVariants) {
                    const fallbackQuery = `
            SELECT
              COALESCE(merchant, 'Unknown') as merchant,
              COALESCE(SUM(amount), 0) as net_spend,
              COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
              COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
              COUNT(*) as transaction_count
            FROM transactions
            GROUP BY COALESCE(merchant, 'Unknown')
            ORDER BY net_spend DESC, gross_spend DESC, merchant ASC
            LIMIT $1
          `;
                    result = await pool.query(fallbackQuery, [safeLimit]);
                }

                console.log("ROWS RETURNED:", result.rows.length);

                if (result.rows.length === 0) {
                    return {
                        noData: true,
                        merchants: [],
                        answer: "No data found for top merchants in your records.",
                    };
                }

                const merchants = result.rows.map((r, i) => ({
                    rank: i + 1,
                    merchant: r.merchant,
                    netSpend: Number(Number(r.net_spend || 0).toFixed(2)),
                    grossSpend: Number(Number(r.gross_spend || 0).toFixed(2)),
                    refunds: Number(Number(r.refunds || 0).toFixed(2)),
                    transactionCount: Number(r.transaction_count || 0),
                }));

                return {
                    noData: false,
                    merchants,
                    answer: buildAnswerTopMerchants(merchants),
                };
            }

            // monthly
            if (mode === "monthly") {
                const result = await pool.query(
                    `
          SELECT
            TO_CHAR(date, 'YYYY-MM') as month,
            COALESCE(SUM(amount), 0) as net_spend,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds,
            COUNT(*) as transaction_count
          FROM transactions
          ${whereClause}
          GROUP BY TO_CHAR(date, 'YYYY-MM')
          ORDER BY month ASC
          `,
                    baseParams
                );

                console.log("ROWS RETURNED:", result.rows.length);

                if (result.rows.length === 0) {
                    return {
                        noData: true,
                        monthly: [],
                        answer: "No transactions found.",
                    };
                }

                const monthly = result.rows.map((r) => ({
                    month: r.month,
                    netSpend: Number(Number(r.net_spend || 0).toFixed(2)),
                    grossSpend: Number(Number(r.gross_spend || 0).toFixed(2)),
                    refunds: Number(Number(r.refunds || 0).toFixed(2)),
                    transactionCount: Number(r.transaction_count || 0),
                }));

                return {
                    noData: false,
                    monthly,
                    answer: "Monthly breakdown computed successfully.",
                };
            }

            // recurring
            if (mode === "recurring") {
                const result = await pool.query(
                    `
          SELECT
            merchant,
            category,
            COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) as months_active,
            COUNT(*) as total_txns,
            ROUND(AVG(amount)::numeric, 2) as avg_amount,
            COALESCE(ROUND(STDDEV(amount)::numeric, 2), 0) as stddev_amount,
            ROUND(AVG(EXTRACT(DAY FROM date))::numeric, 1) as avg_day,
            COALESCE(ROUND(STDDEV(EXTRACT(DAY FROM date))::numeric, 1), 0) as stddev_day
          FROM transactions
          ${whereClause}
          GROUP BY merchant, category
          HAVING COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) >= 2
          ORDER BY months_active DESC, total_txns DESC
          LIMIT $${p}
          `,
                    [...baseParams, safeLimit]
                );

                console.log("ROWS RETURNED:", result.rows.length);

                if (result.rows.length === 0) {
                    return {
                        noData: true,
                        recurringMerchants: [],
                        answer: "No recurring merchants found in your records.",
                    };
                }

                const recurringMerchants = result.rows.map((r) => {
                    const months = Number(r.months_active || 0);
                    const stddevAmt = Number(r.stddev_amount || 0);
                    const stddevDay = Number(r.stddev_day || 0);

                    let confidence: "low" | "medium" | "high" = "low";
                    if (months >= 6 && stddevAmt < 5 && stddevDay < 5) confidence = "high";
                    else if (months >= 3 && stddevAmt < 50) confidence = "medium";

                    return {
                        merchant: r.merchant,
                        category: r.category,
                        monthsActive: months,
                        totalTransactions: Number(r.total_txns || 0),
                        avgAmount: Number(r.avg_amount || 0),
                        confidence,
                        isLikelySubscription: confidence !== "low",
                    };
                });

                return {
                    noData: false,
                    recurringMerchants,
                    answer: "Recurring merchants identified successfully.",
                };
            }

            // compare
            if (mode === "compare") {
                const catA = category.trim();
                const catB = categoryB.trim();

                if (!catA || !catB) {
                    return {
                        error: "compare needs category and categoryB both filled",
                        answer: "Compare mode requires two categories.",
                    };
                }

                const dateConditions: string[] = [];
                const dateParams: any[] = [];
                let dp = 1;

                if (startDate) {
                    dateConditions.push(`date >= $${dp++}`);
                    dateParams.push(startDate);
                }
                if (endDate) {
                    dateConditions.push(`date <= $${dp++}`);
                    dateParams.push(endDate);
                }

                const dateWhere =
                    dateConditions.length > 0 ? `AND ${dateConditions.join(" AND ")}` : "";

                const result = await pool.query(
                    `
          SELECT
            TO_CHAR(date, 'YYYY-MM') as month,
            LOWER(category) as cat,
            COALESCE(SUM(amount), 0) as net_spend
          FROM transactions
          WHERE LOWER(category) IN (LOWER($${dp}), LOWER($${dp + 1}))
          AND LOWER(COALESCE(category, '')) NOT LIKE '%transfer%'
          ${dateWhere}
          GROUP BY TO_CHAR(date, 'YYYY-MM'), LOWER(category)
          ORDER BY month ASC
          `,
                    [...dateParams, catA, catB]
                );

                console.log("ROWS RETURNED:", result.rows.length);

                if (result.rows.length === 0) {
                    return {
                        noData: true,
                        comparison: [],
                        answer: `No data found for ${catA} or ${catB}.`,
                    };
                }

                const catALow = catA.toLowerCase();
                const catBLow = catB.toLowerCase();
                const monthMap: Record<string, any> = {};

                for (const row of result.rows) {
                    if (!monthMap[row.month]) {
                        monthMap[row.month] = { month: row.month, [catALow]: 0, [catBLow]: 0 };
                    }
                    monthMap[row.month][row.cat] = Number(Number(row.net_spend || 0).toFixed(2));
                }

                const comparison = Object.values(monthMap).map((m: any) => ({
                    ...m,
                    difference: Number((m[catALow] - m[catBLow]).toFixed(2)),
                }));

                const active = comparison.filter((m: any) => m[catALow] > 0 && m[catBLow] > 0);

                let growthSummary = "Not enough data to compute growth.";
                if (active.length >= 2) {
                    const first = active[0];
                    const last = active[active.length - 1];

                    const gA =
                        first[catALow] > 0
                            ? ((last[catALow] - first[catALow]) / first[catALow]) * 100
                            : 0;

                    const gB =
                        first[catBLow] > 0
                            ? ((last[catBLow] - first[catBLow]) / first[catBLow]) * 100
                            : 0;

                    const faster = gA > gB ? catA : catB;
                    growthSummary = `${faster} grew faster. ${catA}: ${gA.toFixed(
                        1
                    )}% growth, ${catB}: ${gB.toFixed(1)}% growth (${first.month} to ${last.month}).`;
                }

                return {
                    noData: false,
                    categoryA: catA,
                    categoryB: catB,
                    comparison,
                    growthSummary,
                    answer: growthSummary,
                };
            }

            return {
                error: "Invalid mode",
                answer: "Invalid mode.",
            };
        } catch (err: any) {
            console.error("QUERY TRANSACTIONS ERROR:", err);
            return {
                error: `DB error: ${err.message}`,
                answer: `Database error: ${err.message}`,
            };
        }
    },
});