-- Align new preference rows with the application's default appearance.
-- Existing personal choices remain untouched.
ALTER TABLE user_preferences
  ALTER COLUMN accent SET DEFAULT 'company',
  ALTER COLUMN sidebar_variant SET DEFAULT 'floating',
  ALTER COLUMN sidebar_mode SET DEFAULT 'full';
