CREATE TABLE trip_crew (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('driver','manager')),
 can_drive boolean NOT NULL DEFAULT false,
 can_collect boolean NOT NULL DEFAULT false,
 can_board boolean NOT NULL DEFAULT false,
 can_manage boolean NOT NULL DEFAULT false,
 can_gps boolean NOT NULL DEFAULT false,
 pay_minor bigint NOT NULL DEFAULT 0 CHECK(pay_minor BETWEEN 0 AND 10000000000),
 pay_currency text NOT NULL CHECK(pay_currency IN ('UAH','EUR','USD','PLN')),
 is_active boolean NOT NULL DEFAULT true,
 is_primary boolean NOT NULL DEFAULT false,
 source_legacy boolean NOT NULL DEFAULT false,
 custom_pay boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,trip_id,membership_id),
 CHECK(NOT can_gps OR (can_drive AND role='driver')),
 CHECK(NOT can_drive OR role='driver')
);
CREATE UNIQUE INDEX trip_crew_one_gps ON trip_crew(tenant_id,trip_id) WHERE is_active AND can_gps;
CREATE UNIQUE INDEX trip_crew_one_primary ON trip_crew(tenant_id,trip_id) WHERE is_active AND is_primary;
CREATE INDEX trip_crew_membership ON trip_crew(tenant_id,membership_id,trip_id) WHERE is_active;

CREATE FUNCTION check_trip_crew_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM trips WHERE id=NEW.trip_id AND tenant_id=NEW.tenant_id)
 OR NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=NEW.membership_id AND m.tenant_id=NEW.tenant_id AND NOT u.is_system)
 THEN RAISE EXCEPTION 'Crew belongs to another company or system identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_crew_tenant BEFORE INSERT OR UPDATE ON trip_crew FOR EACH ROW EXECUTE FUNCTION check_trip_crew_tenant();

INSERT INTO trip_crew(tenant_id,trip_id,membership_id,role,can_drive,can_collect,can_board,can_manage,can_gps,pay_minor,pay_currency,is_primary,source_legacy)
 SELECT t.tenant_id,t.id,d.membership_id,'driver',true,true,true,true,true,coalesce(t.driver_pay_minor,0),t.currency,true,true
 FROM trips t JOIN drivers d ON d.id=t.driver_id AND d.tenant_id=t.tenant_id
 JOIN memberships m ON m.id=d.membership_id AND m.tenant_id=t.tenant_id JOIN users u ON u.id=m.user_id
 WHERE NOT u.is_system;

CREATE FUNCTION sync_trip_primary_crew() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member uuid; gps_exists boolean;
BEGIN
 SELECT d.membership_id INTO member FROM drivers d JOIN memberships m ON m.id=d.membership_id AND m.tenant_id=d.tenant_id JOIN users u ON u.id=m.user_id
 WHERE d.id=NEW.driver_id AND d.tenant_id=NEW.tenant_id AND NOT u.is_system;
 IF TG_OP='UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id
 AND EXISTS(SELECT 1 FROM trip_crew WHERE tenant_id=NEW.tenant_id AND trip_id=NEW.id AND membership_id=member AND is_primary) THEN
  UPDATE trip_crew SET pay_minor=coalesce(NEW.driver_pay_minor,0),pay_currency=NEW.currency,updated_at=now()
  WHERE tenant_id=NEW.tenant_id AND trip_id=NEW.id AND is_primary AND NOT custom_pay;
  RETURN NEW;
 END IF;
 UPDATE trip_crew SET is_active=CASE WHEN source_legacy THEN false ELSE is_active END,
  can_gps=CASE WHEN source_legacy THEN false ELSE can_gps END,is_primary=false,updated_at=now()
 WHERE tenant_id=NEW.tenant_id AND trip_id=NEW.id AND is_primary;
 IF member IS NULL THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM trip_crew WHERE tenant_id=NEW.tenant_id AND trip_id=NEW.id AND is_active AND can_gps) INTO gps_exists;
 INSERT INTO trip_crew(tenant_id,trip_id,membership_id,role,can_drive,can_collect,can_board,can_manage,can_gps,pay_minor,pay_currency,is_primary,source_legacy)
 VALUES(NEW.tenant_id,NEW.id,member,'driver',true,true,true,true,NOT gps_exists,coalesce(NEW.driver_pay_minor,0),NEW.currency,true,true)
 ON CONFLICT(tenant_id,trip_id,membership_id) DO UPDATE SET is_active=true,is_primary=true,
  can_drive=true,role='driver',can_gps=trip_crew.can_gps OR NOT gps_exists,updated_at=now();
 RETURN NEW;
END $$;
CREATE TRIGGER trips_primary_crew AFTER INSERT OR UPDATE OF driver_id,driver_pay_minor,currency ON trips FOR EACH ROW EXECUTE FUNCTION sync_trip_primary_crew();

CREATE FUNCTION sync_driver_membership_crew() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE trips SET driver_id=driver_id WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER drivers_membership_crew AFTER UPDATE OF membership_id ON drivers FOR EACH ROW WHEN (NEW.membership_id IS DISTINCT FROM OLD.membership_id) EXECUTE FUNCTION sync_driver_membership_crew();

CREATE TABLE crew_payroll_accruals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 -- Retained immutable references: removing operational records must not erase
 -- financial history or be prevented by its references.
 trip_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 expense_id uuid NOT NULL,
 gross_minor bigint NOT NULL CHECK(gross_minor>0),
 currency text NOT NULL CHECK(currency IN ('UAH','EUR','USD','PLN')),
 occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,trip_id,membership_id)
);
CREATE FUNCTION immutable_crew_payroll() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Crew payroll accruals are immutable; use an attributed correction'; END $$;
CREATE TRIGGER crew_payroll_immutable BEFORE UPDATE OR DELETE ON crew_payroll_accruals FOR EACH ROW EXECUTE FUNCTION immutable_crew_payroll();
CREATE FUNCTION check_crew_accrual_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM trips WHERE tenant_id=NEW.tenant_id AND id=NEW.trip_id)
 OR NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND id=NEW.membership_id)
 OR NOT EXISTS(SELECT 1 FROM operational_expenses WHERE tenant_id=NEW.tenant_id AND id=NEW.expense_id)
 THEN RAISE EXCEPTION 'Crew accrual origin belongs to another company or is missing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crew_accrual_origin BEFORE INSERT ON crew_payroll_accruals FOR EACH ROW EXECUTE FUNCTION check_crew_accrual_origin();

CREATE TABLE crew_payroll_payouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 accrual_id uuid NOT NULL REFERENCES crew_payroll_accruals(id) ON DELETE RESTRICT,
 journal_id uuid NOT NULL REFERENCES money_journal(id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL CHECK(currency IN ('UAH','EUR','USD','PLN')),
 actor_membership_id uuid NOT NULL,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_id)
);
CREATE TRIGGER crew_payout_immutable BEFORE UPDATE OR DELETE ON crew_payroll_payouts FOR EACH ROW EXECUTE FUNCTION immutable_crew_payroll();
