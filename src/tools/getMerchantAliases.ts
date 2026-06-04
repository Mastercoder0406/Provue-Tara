import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

export const getMerchantAliases = createTool({
    id: "get_merchant_aliases",
    description: `
    Find all merchant name variants in the database that match a given merchant.
    Use this BEFORE querying transactions for a specific merchant,
    so you can find all aliases (e.g. Swiggy, SWIGGY*ORDER, Swiggy Instamart, SWIGGY BANGALORE).
    Returns the canonical merchant name and all variants found in the data.
  `,
    inputSchema: z.object({
        merchantName: z.string().describe("Merchant to search for e.g. 'Swiggy', 'Netflix', 'Amazon'"),
    }),

    execute: async ({ merchantName }) => {

        if (!merchantName || merchantName.trim() === "") {
            return { error: "merchantName is required" };
        }

        try {
            const result = await pool.query(
                `SELECT
          merchant,
          COUNT(*) as transaction_count,
          COALESCE(SUM(amount), 0) as total_amount
         FROM transactions
         WHERE LOWER(merchant) LIKE LOWER($1)
         GROUP BY merchant
         ORDER BY transaction_count DESC`,
                [`%${merchantName.trim()}%`]
            );

            if (result.rows.length === 0) {
                return {
                    found: false,
                    message: `No merchants found matching "${merchantName}"`,
                    aliases: [],
                };
            }

            return {
                found: true,
                searchTerm: merchantName,
                aliases: result.rows.map((r) => ({
                    merchant: r.merchant,
                    transactionCount: Number(r.transaction_count),
                    totalAmount: Number(Number(r.total_amount).toFixed(2)),
                })),
                totalAliasCount: result.rows.length,
            };
        } catch (err: any) {
            return { error: `Database error: ${err.message}` };
        }
    },
});