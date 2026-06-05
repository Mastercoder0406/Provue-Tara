import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

export const getMerchantAliases = createTool({
    id: "get_merchant_aliases",
    description: "Find all merchant name variants in DB. Call this BEFORE querying any specific merchant. Returns variantsForQuery field — pass it directly to merchantVariants in query_transactions.",
    inputSchema: z.object({
        merchantName: z.string(),
    }),

    execute: async ({ merchantName = "" }) => {
        if (!merchantName.trim()) return { error: "merchantName required" };

        try {
            const result = await pool.query(`
        SELECT
          merchant,
          COUNT(*) as transaction_count,
          COALESCE(SUM(amount), 0) as net_spend,
          COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as gross_spend,
          COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as refunds
        FROM transactions
        WHERE LOWER(merchant) LIKE LOWER($1)
        AND LOWER(category) != 'transfer'
        GROUP BY merchant
        ORDER BY transaction_count DESC
      `, [`%${merchantName.trim()}%`]);

            if (result.rows.length === 0) {
                return {
                    found: false,
                    message: `No merchants found matching "${merchantName}"`,
                    aliases: [],
                    variantsForQuery: "",
                    combinedNetSpend: 0,
                    combinedGrossSpend: 0,
                };
            }

            const aliases = result.rows.map((r) => ({
                merchant: r.merchant,
                transactionCount: Number(r.transaction_count),
                netSpend: Number(Number(r.net_spend).toFixed(2)),
                grossSpend: Number(Number(r.gross_spend).toFixed(2)),
                refunds: Number(Number(r.refunds).toFixed(2)),
            }));

            const combinedNet = aliases.reduce((s, a) => s + a.netSpend, 0);
            const combinedGross = aliases.reduce((s, a) => s + a.grossSpend, 0);

            return {
                found: true,
                searchTerm: merchantName,
                aliasCount: aliases.length,
                aliases,
                variantsForQuery: aliases.map((a) => a.merchant).join(","),
                combinedNetSpend: Number(combinedNet.toFixed(2)),
                combinedGrossSpend: Number(combinedGross.toFixed(2)),
            };
        } catch (err: any) {
            return { error: `DB error: ${err.message}` };
        }
    },
});