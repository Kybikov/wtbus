ALTER TABLE tenant_branding
  ADD COLUMN dispatcher_contact TEXT NOT NULL DEFAULT ''
  CHECK (char_length(dispatcher_contact) <= 160);
