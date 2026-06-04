-- Drop tables if re-running (safe to re-run)
DROP TABLE IF EXISTS holdings
CASCADE;
DROP TABLE IF EXISTS fund_nav
CASCADE;
DROP TABLE IF EXISTS funds
CASCADE;
DROP TABLE IF EXISTS transactions
CASCADE;

-- Transactions table: 15 months of spending
CREATE TABLE transactions
(
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    merchant TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'uncategorized',
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    memo TEXT
);

CREATE INDEX idx_transactions_date     ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(category);
CREATE INDEX idx_transactions_merchant ON transactions(merchant);
CREATE INDEX idx_transactions_amount   ON transactions(amount);

-- Funds table: mutual fund info
CREATE TABLE funds
(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL
);

-- Fund NAV history: one row per fund per date
CREATE TABLE fund_nav
(
    fund_id TEXT NOT NULL REFERENCES funds(id),
    date DATE NOT NULL,
    nav NUMERIC(12, 4) NOT NULL,
    PRIMARY KEY (fund_id, date)
);

CREATE INDEX idx_fund_nav_fund_date ON fund_nav(fund_id, date);

-- Holdings: what the user actually owns
CREATE TABLE holdings
(
    id TEXT PRIMARY KEY,
    fund_id TEXT NOT NULL REFERENCES funds(id),
    fund_name TEXT NOT NULL,
    units NUMERIC(12, 4) NOT NULL,
    purchase_date DATE NOT NULL,
    purchase_nav NUMERIC(12, 4) NOT NULL
);