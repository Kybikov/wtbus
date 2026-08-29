ALTER TABLE tenant_payment_configs
  DROP CONSTRAINT IF EXISTS tenant_payment_configs_provider_check;

ALTER TABLE tenant_payment_configs
  ADD COLUMN IF NOT EXISTS api_key_ciphertext BYTEA;
