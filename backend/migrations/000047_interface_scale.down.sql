UPDATE user_preferences SET scale=CASE WHEN scale='xs' THEN 'sm' ELSE 'lg' END WHERE scale IN ('xs','xl');
ALTER TABLE user_preferences DROP CONSTRAINT user_preferences_scale_check;
ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_scale_check CHECK (scale IN ('sm','md','lg'));
