import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

export const getFundReturns = createTool({
    id: "get_fund_returns",
    description: `
    Get period return for one or all mutual funds between two dates.
    Period return = (NAV at end date - NAV at start date) / NAV at start date x 100
    Use this when user asks about fund performance between dates.
    This is the FUND's return, not the user's personal holding return.
    For user's personal return on their investment, use get_holding_returns instead.
  `,
    inputSchema: z.object({
        startDate: z.string().describe("Start date YYYY-MM-DD"),
        endDate: z.string().describe("End date YYYY-MM-DD"),
        fundId: z.string().nullable().optional().describe("Specific fund ID — omit to get all funds"),
        rankResults: z.boolean().nullable().optional().default(false).describe("Sort by return descending"),
    }),

    execute: async ({ startDate, endDate, fundId, rankResults }) => {

        if (!startDate || !endDate) {
            return { error: "startDate and endDate are required" };
        }

        try {
            const safeFundId = fundId && fundId !== null ? fundId : null;

            const query = `
        SELECT
          f.id as fund_id,
          f.name as fund_name,
          f.category,
          start_nav.nav as start_nav,
          start_nav.date as start_date,
          end_nav.nav as end_nav,
          end_nav.date as end_date
        FROM funds f
        JOIN LATERAL (
          SELECT nav, date FROM fund_nav
          WHERE fund_id = f.id AND date >= $1::date
          ORDER BY date ASC LIMIT 1
        ) start_nav ON true
        JOIN LATERAL (
          SELECT nav, date FROM fund_nav
          WHERE fund_id = f.id AND date <= $2::date
          ORDER BY date DESC LIMIT 1
        ) end_nav ON true
        ${safeFundId ? "WHERE f.id = $3" : ""}
        ORDER BY f.name
      `;

            const params = safeFundId ? [startDate, endDate, safeFundId] : [startDate, endDate];
            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return {
                    found: false,
                    message: `No NAV data found between ${startDate} and ${endDate}`,
                    funds: [],
                };
            }

            const funds = result.rows.map((r) => {
                const startNav = Number(r.start_nav);
                const endNav = Number(r.end_nav);
                const periodReturn = ((endNav - startNav) / startNav) * 100;

                return {
                    fundId: r.fund_id,
                    fundName: r.fund_name,
                    category: r.category,
                    startDate: r.start_date,
                    endDate: r.end_date,
                    startNav: Number(startNav.toFixed(4)),
                    endNav: Number(endNav.toFixed(4)),
                    periodReturnPercent: Number(periodReturn.toFixed(2)),
                    absoluteChange: Number((endNav - startNav).toFixed(4)),
                };
            });

            if (rankResults === true) {
                funds.sort((a, b) => b.periodReturnPercent - a.periodReturnPercent);

                const ranked = funds.map((f, i) => ({ ...f, rank: i + 1 }));
                const best = ranked[0];
                const worst = ranked[ranked.length - 1];

                return {
                    funds: ranked,
                    spread: Number((best.periodReturnPercent - worst.periodReturnPercent).toFixed(2)),
                    bestFund: best.fundName,
                    worstFund: worst.fundName,
                };
            }

            return { funds };

        } catch (err: any) {
            return { error: `Database error: ${err.message}` };
        }
    },
});