DROP INDEX IF EXISTS payments_checkout_token_hash_idx;
ALTER TABLE payments DROP COLUMN IF EXISTS payment_method;
ALTER TABLE payments DROP COLUMN IF EXISTS checkout_token_hash;
ALTER TABLE tenant_payment_configs ALTER COLUMN provider SET DEFAULT 'splaty';
ALTER TABLE tenant_payment_configs ADD CONSTRAINT tenant_payment_configs_provider_check CHECK (provider = 'splaty');
