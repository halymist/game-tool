CREATE SCHEMA IF NOT EXISTS management;

CREATE TABLE IF NOT EXISTS management.coupons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_management_coupons_expires_at
    ON management.coupons (expires_at);

CREATE TABLE IF NOT EXISTS management.coupon_purchases (
    id BIGSERIAL PRIMARY KEY,
    coupon_id BIGINT NOT NULL REFERENCES management.coupons(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (coupon_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_management_coupon_purchases_account
    ON management.coupon_purchases (account_id);

CREATE INDEX IF NOT EXISTS idx_management_coupon_purchases_coupon
    ON management.coupon_purchases (coupon_id);
