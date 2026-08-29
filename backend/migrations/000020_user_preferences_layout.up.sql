ALTER TABLE user_preferences
  ADD COLUMN scale TEXT NOT NULL DEFAULT 'md' CHECK (scale IN ('sm', 'md', 'lg')),
  ADD COLUMN sidebar_variant TEXT NOT NULL DEFAULT 'default' CHECK (sidebar_variant IN ('default', 'inset', 'floating')),
  ADD COLUMN sidebar_mode TEXT NOT NULL DEFAULT 'default' CHECK (sidebar_mode IN ('default', 'icon', 'full'));
