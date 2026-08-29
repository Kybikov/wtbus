ALTER TABLE tenant_payment_configs DROP CONSTRAINT IF EXISTS tenant_payment_configs_provider_check;
ALTER TABLE tenant_payment_configs ALTER COLUMN provider SET DEFAULT 'internal';
UPDATE tenant_payment_configs SET provider = 'internal' WHERE provider = 'splaty';

ALTER TABLE payments ADD COLUMN checkout_token_hash BYTEA;
ALTER TABLE payments ADD COLUMN payment_method TEXT CHECK (payment_method IN ('bank_transfer', 'cash'));
CREATE UNIQUE INDEX payments_checkout_token_hash_idx ON payments (checkout_token_hash) WHERE checkout_token_hash IS NOT NULL;
