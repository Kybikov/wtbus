ALTER TABLE user_preferences
  DROP COLUMN IF EXISTS sidebar_mode,
  DROP COLUMN IF EXISTS sidebar_variant,
  DROP COLUMN IF EXISTS scale;
