CREATE TABLE tenant_payment_configs (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'splaty' CHECK (provider = 'splaty'),
  api_key_ciphertext BYTEA,
  merchant_name TEXT NOT NULL,
  iban TEXT NOT NULL,
  edrpou TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  logo_url TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
