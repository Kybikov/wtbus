-- PostgreSQL cannot safely remove one enum value in place. Downgrade accounts
-- to admin and retain the unused value so existing enum dependencies stay intact.
UPDATE memberships SET role = 'admin' WHERE role = 'developer';
