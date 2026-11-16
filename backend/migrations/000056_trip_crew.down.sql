DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM crew_payroll_accruals) THEN RAISE EXCEPTION 'Cannot discard crew payroll history'; END IF;
END $$;
DROP TABLE crew_payroll_payouts;
DROP TABLE crew_payroll_accruals;
DROP FUNCTION check_crew_accrual_origin();
DROP FUNCTION immutable_crew_payroll();
DROP TRIGGER drivers_membership_crew ON drivers;
DROP FUNCTION sync_driver_membership_crew();
DROP TRIGGER trips_primary_crew ON trips;
DROP FUNCTION sync_trip_primary_crew();
DROP TABLE trip_crew;
DROP FUNCTION check_trip_crew_tenant();
