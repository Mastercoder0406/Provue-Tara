import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

export const getHoldingReturns = createTool({
    id: "get_holding_returns",
    description: `
    Get the user's personal realised return on their mutual fund holdings.
    Realised return = (current value - purchase cost) / purchase cost x 100
    Where:
      current value = units x latest available NAV
      purchase cost = units x purchase NAV
    Use this when user asks "how much have I made", "my portfolio return",
    "realised return on my holding", or "what is my portfolio worth".
    This is DIFFERENT from fund period return — this is the user's personal P&L.
  `,
    inputSchema: z.object({
        fundId: z.string().nullable().optional().describe("Specific fund ID — omit to get all holdings"),
        fundName: z.string().nullable().optional().describe("Partial fund name search"),
    }),

    execute: async ({ fundId, fundName }) => {

        try {
            const conditions: string[] = [];
            const params: any[] = [];
            let paramIndex = 1;

            if (fundId && fundId !== null) {
                conditions.push(`h.fund_id = $${paramIndex++}`);
                params.push(fundId);
            }
            if (fundName && fundName !== null) {
                conditions.push(`LOWER(h.fund_name) LIKE LOWER($${paramIndex++})`);
                params.push(`%${fundName}%`);
            }

            const whereClause = conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

            const query = `
        SELECT
          h.id,
          h.fund_id,
          h.fund_name,
          h.units,
          h.purchase_date,
          h.purchase_nav,
          latest.nav as current_nav,
          latest.date as current_nav_date,
          (h.units * h.purchase_nav) as purchase_cost,
          (h.units * latest.nav) as current_value
        FROM holdings h
        JOIN LATERAL (
          SELECT nav, date FROM fund_nav
          WHERE fund_id = h.fund_id
          ORDER BY date DESC LIMIT 1
        ) latest ON true
        ${whereClause}
        ORDER BY h.fund_name
      `;

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return {
                    found: false,
                    message: "No holdings found in the database.",
                    holdings: [],
                };
            }

            let totalPurchaseCost = 0;
            let totalCurrentValue = 0;

            const holdings = result.rows.map((r) => {
                const purchaseCost = Number(r.purchase_cost);
                const currentValue = Number(r.current_value);
                const absoluteReturn = currentValue - purchaseCost;
                const returnPercent = ((currentValue - purchaseCost) / purchaseCost) * 100;

                totalPurchaseCost += purchaseCost;
                totalCurrentValue += currentValue;

                return {
                    fundId: r.fund_id,
                    fundName: r.fund_name,
                    units: Number(r.units),
                    purchaseDate: r.purchase_date,
                    purchaseNav: Number(r.purchase_nav),
                    currentNav: Number(r.current_nav),
                    currentNavDate: r.current_nav_date,
                    purchaseCost: Number(purchaseCost.toFixed(2)),
                    currentValue: Number(currentValue.toFixed(2)),
                    absoluteReturnINR: Number(absoluteReturn.toFixed(2)),
                    returnPercent: Number(returnPercent.toFixed(2)),
                };
            });

            // Sort by return percent descending
            holdings.sort((a, b) => b.returnPercent - a.returnPercent);
            const ranked = holdings.map((h, i) => ({ ...h, rank: i + 1 }));

            const portfolioReturn =
                ((totalCurrentValue - totalPurchaseCost) / totalPurchaseCost) * 100;

            return {
                holdings: ranked,
                portfolio: {
                    totalPurchaseCost: Number(totalPurchaseCost.toFixed(2)),
                    totalCurrentValue: Number(totalCurrentValue.toFixed(2)),
                    totalAbsoluteReturnINR: Number((totalCurrentValue - totalPurchaseCost).toFixed(2)),
                    portfolioReturnPercent: Number(portfolioReturn.toFixed(2)),
                },
            };

        } catch (err: any) {
            return { error: `Database error: ${err.message}` };
        }
    },
});