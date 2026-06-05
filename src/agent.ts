import { Agent } from "@mastra/core/agent";
import { createGroq } from "@ai-sdk/groq";
import {
   queryTransactions,
   getMerchantAliases,
   getFundReturns,
   getHoldingReturns,
} from "./tools/index";

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

function todayContext(): string {
   const n = new Date();
   const pad = (x: number) => String(x).padStart(2, "0");
   const y = n.getFullYear();
   const m = n.getMonth() + 1;
   const d = n.getDate();
   const today = `${y}-${pad(m)}-${pad(d)}`;
   const lm = new Date(y, m - 2, 1);
   const lme = new Date(y, m - 1, 0);
   const lmS = `${lm.getFullYear()}-${pad(lm.getMonth() + 1)}-01`;
   const lmE = `${lme.getFullYear()}-${pad(lme.getMonth() + 1)}-${pad(lme.getDate())}`;
   const tmS = `${y}-${pad(m)}-01`;
   return `TODAY:${today},LAST_MONTH:${lmS}to${lmE},THIS_MONTH:${tmS}to${today}`;
}

export const tara = new Agent({
   id: "tara",
   name: "Tara",
   instructions: `Finance assistant. Only answer from tool results. Never invent numbers.

DATES: ${todayContext()}
Jan2025=2025-01-01to2025-01-31,Feb2025=2025-02-01to2025-02-28,Mar2025=2025-03-01to2025-03-31,Q12025=2025-01-01to2025-03-31,2025=2025-01-01to2025-12-31,2024=2024-01-01to2024-12-31

TOOL RULES:
query_transactions requires 8 fields - always provide all 8:
  mode: total|top_merchants|monthly|recurring|compare
  startDate: YYYY-MM-DD or empty string
  endDate: YYYY-MM-DD or empty string
  category: category name or empty string
  merchant: partial name or empty string
  merchantVariants: comma list from get_merchant_aliases or empty string
  limit: number always provide 10 if unsure
  categoryB: second category for compare mode or empty string

MERCHANT RULE: always call get_merchant_aliases first then use variantsForQuery in merchantVariants.
NO DATA RULE: if noData=true say "No data found for X in your records." never invent.
MATH RULE: report numbers from tool only. Never calculate yourself.
COMPARE RULE: use mode=compare, report growthSummary field from result.
FUND RULE: period return=get_fund_returns. personal portfolio=get_holding_returns.`,

   model: groq("llama3-groq-70b-8192-tool-use-preview"),

   tools: {
      query_transactions: queryTransactions,
      get_merchant_aliases: getMerchantAliases,
      get_fund_returns: getFundReturns,
      get_holding_returns: getHoldingReturns,
   },
});