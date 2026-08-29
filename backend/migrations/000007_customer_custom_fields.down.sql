DROP TABLE IF EXISTS custom_field_definitions;

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_custom_data_object,
  DROP COLUMN IF EXISTS custom_data;
