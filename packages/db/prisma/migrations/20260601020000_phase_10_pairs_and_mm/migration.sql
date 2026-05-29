-- Phase 10 slice 2: add the 6 remaining listed trading pairs. The
-- market-maker seed users ("mm.alpha", "mm.beta") and their pre-funded
-- spot balances are seeded by `prisma/seed.ts` so the password hashes
-- stay in one place (scrypt with a real random salt per install).
--
-- Additive only — no destructive ALTER, no DROP.

INSERT INTO "trading_pairs" ("id", "base", "quote", "active", "minOrderSize", "priceTick") VALUES
    ('tp_btcusdc',  'BTC',  'USDC', true, 0.00010000, 0.01000000),
    ('tp_ethbtc',   'ETH',  'BTC',  true, 0.00100000, 0.00000100),
    ('tp_ltcusdt',  'LTC',  'USDT', true, 0.01000000, 0.01000000),
    ('tp_ltcbtc',   'LTC',  'BTC',  true, 0.01000000, 0.00000100),
    ('tp_dogeusdt', 'DOGE', 'USDT', true, 1.00000000, 0.00001000),
    ('tp_usdcusdt', 'USDC', 'USDT', true, 1.00000000, 0.00010000)
ON CONFLICT ("base", "quote") DO NOTHING;
