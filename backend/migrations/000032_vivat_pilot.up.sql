UPDATE users
SET display_name = 'Vivat Pilot',
    updated_at = now()
WHERE is_system
  AND email LIKE 'automation+%@system.local';
