ALTER TABLE user_preferences DROP CONSTRAINT user_preferences_scale_check;
ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_scale_check CHECK (scale IN ('xs','sm','md','lg','xl'));
