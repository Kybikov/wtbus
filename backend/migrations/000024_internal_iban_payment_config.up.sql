-- The payment flow uses only an internal IBAN transfer configuration.
-- No external provider credential is stored in this service.
ALTER TABLE tenant_payment_configs
  DROP COLUMN IF EXISTS api_key_ciphertext;

ALTER TABLE tenant_payment_configs
  DROP CONSTRAINT IF EXISTS tenant_payment_configs_provider_check;

ALTER TABLE tenant_payment_configs
  ADD CONSTRAINT tenant_payment_configs_provider_check
  CHECK (provider = 'internal');
