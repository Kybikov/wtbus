DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['customers','bookings','trips','routes','vehicles','memberships','individual_transfer_requests','availability_blocks'] LOOP
  EXECUTE format('DROP TRIGGER record_number_insert ON %I',table_name);
  EXECUTE format('DROP TRIGGER record_number_delete ON %I',table_name);
 END LOOP;
END $$;
DROP FUNCTION assign_record_number();
DROP FUNCTION default_record_prefix(text);
DROP TABLE record_numbers;
DROP TABLE record_number_settings;
