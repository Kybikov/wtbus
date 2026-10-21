ALTER TABLE driver_cash_ledger
  ADD COLUMN actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN request_id uuid;
CREATE UNIQUE INDEX driver_cash_request_idx ON driver_cash_ledger(tenant_id,request_id) WHERE request_id IS NOT NULL;
ALTER TABLE operational_expenses
  ADD COLUMN driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  ADD COLUMN actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  ADD COLUMN payment_source text NOT NULL DEFAULT 'unallocated' CHECK(payment_source IN ('cash','bank','unallocated')),
  ADD COLUMN request_id uuid,
  ADD COLUMN source_key text;
ALTER TABLE operational_expenses DROP CONSTRAINT operational_expenses_category_check;
ALTER TABLE operational_expenses ADD CONSTRAINT operational_expenses_category_check CHECK(category IN ('fuel','driver_pay','payroll_tax','amortization','marketing','other'));
CREATE UNIQUE INDEX operational_expenses_request_idx ON operational_expenses(tenant_id,request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX operational_expenses_source_idx ON operational_expenses(tenant_id,source_key) WHERE source_key IS NOT NULL;
UPDATE operational_expenses e SET driver_id=t.driver_id FROM trips t WHERE t.id=e.trip_id AND t.tenant_id=e.tenant_id AND e.category='driver_pay';

CREATE TABLE company_cash_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency char(3) NOT NULL,
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 500),
 actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(), request_id uuid NOT NULL,
 UNIQUE(tenant_id,request_id)
);
CREATE INDEX company_cash_period_idx ON company_cash_receipts(tenant_id,occurred_at DESC,id DESC);

CREATE TABLE driver_cash_handovers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency char(3) NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled')),
 description text NOT NULL DEFAULT '',requested_by uuid REFERENCES memberships(id) ON DELETE SET NULL,
 resolved_by uuid REFERENCES memberships(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,request_id uuid NOT NULL,
 UNIQUE(tenant_id,request_id)
);
CREATE INDEX driver_cash_handovers_pending_idx ON driver_cash_handovers(tenant_id,driver_id,status);
ALTER TABLE driver_cash_ledger ADD COLUMN handover_id uuid UNIQUE REFERENCES driver_cash_handovers(id) ON DELETE RESTRICT;

CREATE TABLE driver_payroll_settings (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 driver_id uuid PRIMARY KEY REFERENCES drivers(id) ON DELETE RESTRICT,
 income_tax_bps integer NOT NULL CHECK(income_tax_bps BETWEEN 0 AND 10000),
 levy_tax_bps integer NOT NULL CHECK(levy_tax_bps BETWEEN 0 AND 10000),
 employer_tax_bps integer NOT NULL CHECK(employer_tax_bps BETWEEN 0 AND 10000),
 updated_by uuid REFERENCES memberships(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(income_tax_bps+levy_tax_bps<=10000)
);
CREATE TABLE driver_payroll_accruals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
 expense_id uuid NOT NULL UNIQUE REFERENCES operational_expenses(id) ON DELETE RESTRICT,
 trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
 gross_minor bigint NOT NULL CHECK(gross_minor>0),currency char(3) NOT NULL,
 income_tax_minor bigint NOT NULL DEFAULT 0 CHECK(income_tax_minor>=0),
 levy_tax_minor bigint NOT NULL DEFAULT 0 CHECK(levy_tax_minor>=0),
 employer_tax_minor bigint NOT NULL DEFAULT 0 CHECK(employer_tax_minor>=0),
 tax_configured boolean NOT NULL DEFAULT false,tax_snapshot jsonb NOT NULL DEFAULT '{}',
 occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK(income_tax_minor+levy_tax_minor<=gross_minor)
);
CREATE INDEX driver_payroll_driver_idx ON driver_payroll_accruals(tenant_id,driver_id,currency,occurred_at DESC);
INSERT INTO driver_payroll_accruals(tenant_id,driver_id,expense_id,trip_id,gross_minor,currency,occurred_at,tax_configured,tax_snapshot)
 SELECT tenant_id,driver_id,id,trip_id,amount_minor,currency,occurred_at,true,'{"incomeTaxBps":0,"levyTaxBps":0,"employerTaxBps":0}'::jsonb FROM operational_expenses WHERE category='driver_pay' AND driver_id IS NOT NULL;
CREATE TABLE driver_payroll_payouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency char(3) NOT NULL,
 payment_source text NOT NULL CHECK(payment_source IN ('cash','bank')),
 description text NOT NULL DEFAULT '',actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,
 UNIQUE(tenant_id,request_id)
);
CREATE INDEX driver_payroll_payout_driver_idx ON driver_payroll_payouts(tenant_id,driver_id,currency,occurred_at DESC);

CREATE TABLE bank_statement_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 account_id text NOT NULL,provider_id text NOT NULL,
 amount_minor bigint NOT NULL,currency char(3) NOT NULL,balance_minor bigint NOT NULL,
 description text NOT NULL DEFAULT '',comment text NOT NULL DEFAULT '',
 occurred_at timestamptz NOT NULL, is_hold boolean NOT NULL DEFAULT false,
 synced_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,account_id,provider_id)
);
CREATE INDEX bank_statement_period_idx ON bank_statement_transactions(tenant_id,occurred_at DESC,id DESC);
ALTER TABLE payment_reconciliation_state ADD COLUMN token_hash text NOT NULL DEFAULT '',ADD COLUMN statement_synced_at timestamptz;

CREATE TABLE finance_review_marks (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 entry_id text NOT NULL,reviewed boolean NOT NULL DEFAULT false,note text NOT NULL DEFAULT '',
 reviewed_by uuid REFERENCES memberships(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,entry_id)
);
ALTER TABLE company_cash_receipts ADD COLUMN kind text NOT NULL DEFAULT 'income' CHECK(kind IN ('income','funding'));
CREATE TABLE finance_tax_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
 tax_kind text NOT NULL CHECK(tax_kind IN ('income','levy','employer')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),currency char(3) NOT NULL,
 payment_source text NOT NULL CHECK(payment_source IN ('cash','bank')),
 description text NOT NULL DEFAULT '',actor_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,UNIQUE(tenant_id,request_id)
);
CREATE INDEX finance_tax_driver_idx ON finance_tax_payments(tenant_id,driver_id,currency);
ALTER TABLE payment_reconciliation_state ADD COLUMN bank_balance_minor bigint,ADD COLUMN bank_balance_at timestamptz;

CREATE VIEW finance_ledger_entries AS
 SELECT 'bank:'||b.id::text entry_id,b.tenant_id,
 CASE WHEN b.amount_minor>=0 THEN 'bank_credit' ELSE 'bank_debit' END kind,
 ''::text category,b.amount_minor,b.currency,b.occurred_at,concat_ws(' · ',nullif(b.description,''),nullif(b.comment,'')) description,
 NULL::uuid driver_id,''::text driver_name,'Monobank'::text actor_name,p.booking_id,t.id trip_id,'bank'::text payment_source,b.is_hold
 FROM bank_statement_transactions b
 LEFT JOIN LATERAL(SELECT booking_id FROM payments WHERE tenant_id=b.tenant_id AND provider='internal' AND provider_payment_id=b.provider_id LIMIT 1)p ON true
 LEFT JOIN bookings booking ON booking.id=p.booking_id AND booking.tenant_id=b.tenant_id LEFT JOIN trips t ON t.id=booking.trip_id AND t.tenant_id=b.tenant_id
 UNION ALL
 SELECT 'payment:'||p.id::text,p.tenant_id,'booking_payment','',p.amount_minor,p.currency,p.paid_at,'Оплата бронирования',t.driver_id,coalesce(d.full_name,''),'Система',p.booking_id,t.id,'bank',false
 FROM payments p JOIN bookings b ON b.id=p.booking_id AND b.tenant_id=p.tenant_id LEFT JOIN trips t ON t.id=b.trip_id AND t.tenant_id=p.tenant_id LEFT JOIN drivers d ON d.id=t.driver_id AND d.tenant_id=p.tenant_id
 WHERE p.payment_method='bank_transfer' AND p.paid_at IS NOT NULL AND workflow_status_phase(p.tenant_id,'payments',p.status)='paid'
 AND NOT EXISTS(SELECT 1 FROM bank_statement_transactions s WHERE s.tenant_id=p.tenant_id AND s.provider_id=p.provider_payment_id)
 UNION ALL
 SELECT 'cash:'||l.id::text,l.tenant_id,CASE WHEN l.kind='collection' THEN 'cash_handed_in' ELSE 'driver_cash_received' END,'',l.amount_minor,l.currency,l.occurred_at,
 coalesce(nullif(l.description,''),CASE WHEN l.kind='collection' THEN 'Передача наличных в кассу' ELSE 'Наличные от пассажиров' END),l.driver_id,d.full_name,coalesce(u.display_name,'Система'),NULL,l.trip_id,CASE WHEN l.kind='collection' THEN 'cash' ELSE 'driver' END,false
 FROM driver_cash_ledger l JOIN drivers d ON d.id=l.driver_id AND d.tenant_id=l.tenant_id LEFT JOIN memberships m ON m.id=l.actor_membership_id LEFT JOIN users u ON u.id=m.user_id
 UNION ALL
 SELECT 'receipt:'||c.id::text,c.tenant_id,CASE WHEN c.kind='income' THEN 'cash_income' ELSE 'cash_funding' END,'',c.amount_minor,c.currency,c.occurred_at,c.description,NULL,'',coalesce(u.display_name,'Система'),NULL,NULL,'cash',false
 FROM company_cash_receipts c LEFT JOIN memberships m ON m.id=c.actor_membership_id LEFT JOIN users u ON u.id=m.user_id
 UNION ALL
 SELECT 'expense:'||e.id::text,e.tenant_id,'expense',e.category,-e.amount_minor,e.currency,e.occurred_at,e.description,e.driver_id,coalesce(d.full_name,''),coalesce(u.display_name,'Система'),NULL,e.trip_id,e.payment_source,false
 FROM operational_expenses e LEFT JOIN drivers d ON d.id=e.driver_id AND d.tenant_id=e.tenant_id LEFT JOIN memberships m ON m.id=e.actor_membership_id LEFT JOIN users u ON u.id=m.user_id
 WHERE e.category<>'driver_pay' OR NOT EXISTS(SELECT 1 FROM driver_payroll_accruals a WHERE a.expense_id=e.id)
 UNION ALL
 SELECT 'accrual:'||a.id::text,a.tenant_id,'payroll_accrual','driver_pay',a.gross_minor,a.currency,a.occurred_at,'Начислена зарплата',a.driver_id,d.full_name,coalesce(u.display_name,'Система'),NULL,a.trip_id,'unallocated',false
 FROM driver_payroll_accruals a JOIN drivers d ON d.id=a.driver_id AND d.tenant_id=a.tenant_id JOIN operational_expenses e ON e.id=a.expense_id LEFT JOIN memberships m ON m.id=e.actor_membership_id LEFT JOIN users u ON u.id=m.user_id
 UNION ALL
 SELECT 'payout:'||p.id::text,p.tenant_id,'payroll_payout','driver_pay',-p.amount_minor,p.currency,p.occurred_at,p.description,p.driver_id,d.full_name,coalesce(u.display_name,'Система'),NULL,NULL,p.payment_source,false
 FROM driver_payroll_payouts p JOIN drivers d ON d.id=p.driver_id AND d.tenant_id=p.tenant_id LEFT JOIN memberships m ON m.id=p.actor_membership_id LEFT JOIN users u ON u.id=m.user_id
 UNION ALL
 SELECT 'tax:'||p.id::text,p.tenant_id,'tax_payment',p.tax_kind,-p.amount_minor,p.currency,p.occurred_at,p.description,p.driver_id,d.full_name,coalesce(u.display_name,'Система'),NULL,NULL,p.payment_source,false
 FROM finance_tax_payments p JOIN drivers d ON d.id=p.driver_id AND d.tenant_id=p.tenant_id LEFT JOIN memberships m ON m.id=p.actor_membership_id LEFT JOIN users u ON u.id=m.user_id;
CREATE TABLE finance_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 turnover_tax_bps integer NOT NULL DEFAULT 0 CHECK(turnover_tax_bps BETWEEN 0 AND 10000),
 income_tax_bps integer NOT NULL DEFAULT 0 CHECK(income_tax_bps BETWEEN 0 AND 10000),
 levy_tax_bps integer NOT NULL DEFAULT 0 CHECK(levy_tax_bps BETWEEN 0 AND 10000),
 employer_tax_bps integer NOT NULL DEFAULT 0 CHECK(employer_tax_bps BETWEEN 0 AND 10000),
 updated_by uuid REFERENCES memberships(id) ON DELETE SET NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(income_tax_bps+levy_tax_bps<=10000)
);
ALTER TABLE operational_expenses DROP CONSTRAINT operational_expenses_category_check;
ALTER TABLE operational_expenses ADD CONSTRAINT operational_expenses_category_check CHECK(category IN ('fuel','driver_pay','payroll_tax','taxes','amortization','marketing','other'));
CREATE TABLE finance_operation_requests (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,request_id)
);

-- Deletions invalidate clients without inventing payment or status delivery.
CREATE OR REPLACE FUNCTION capture_crm_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  previous jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  company uuid := (item->>'tenant_id')::uuid;
  driver_member uuid;
  event bigint;
  category text;
  event_key text;
  title text;
  body text := 'Откройте приложение, чтобы посмотреть подробности.';
  path text;
BEGIN
  -- Cascaded company deletion must not recreate events referencing the removed tenant.
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=company) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND item=previous THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN
    IF TG_TABLE_NAME='trips' THEN
      SELECT membership_id INTO driver_member FROM drivers WHERE id=(item->>'driver_id')::uuid AND tenant_id=company;
    END IF;
    INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES(company,TG_TABLE_NAME,driver_member);
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME='trips' THEN
    SELECT membership_id INTO driver_member FROM drivers WHERE id=(item->>'driver_id')::uuid AND tenant_id=company;
    IF TG_OP='INSERT' OR item->>'status' IS DISTINCT FROM previous->>'status'
       OR item->>'driver_id' IS DISTINCT FROM previous->>'driver_id'
       OR item->>'starts_at' IS DISTINCT FROM previous->>'starts_at' THEN
      category := 'trips'; title := 'Обновление рейса'; path := '/trips';
    END IF;
  ELSIF TG_TABLE_NAME IN ('bookings','gps_points') THEN
    SELECT d.membership_id INTO driver_member FROM trips t LEFT JOIN drivers d ON d.id=t.driver_id
      WHERE t.id=(item->>'trip_id')::uuid AND t.tenant_id=company;
    IF TG_TABLE_NAME='bookings' AND (TG_OP='INSERT' OR item->>'status' IS DISTINCT FROM previous->>'status') THEN
      category := 'newBookings'; title := CASE WHEN TG_OP='INSERT' THEN 'Новое бронирование' ELSE 'Статус бронирования изменён' END; path := '/bookings';
    END IF;
  ELSIF TG_TABLE_NAME='individual_transfer_requests' AND TG_OP='INSERT' THEN
    category := 'newRequests'; title := 'Новая индивидуальная заявка'; path := '/requests';
  ELSIF TG_TABLE_NAME='payments' AND (TG_OP='INSERT' OR item->>'status' IS DISTINCT FROM previous->>'status') THEN
    category := 'payments'; title := CASE WHEN item->>'status'='paid' THEN 'Оплата подтверждена' ELSE 'Обновление оплаты' END; path := '/finance';
  END IF;
  IF TG_TABLE_NAME='bookings' AND TG_OP<>'DELETE' THEN
    IF TG_OP='INSERT' THEN event_key:='bookingCreated'; title:='Новое бронирование';
    ELSIF item->>'status' IS DISTINCT FROM previous->>'status' OR item->>'seats' IS DISTINCT FROM previous->>'seats' OR item->>'trip_id' IS DISTINCT FROM previous->>'trip_id' THEN
      event_key:=CASE WHEN workflow_status_phase(company,'bookings',item->>'status')='cancelled' THEN 'bookingCancelled' ELSE 'bookingChanged' END;
      title:=CASE WHEN event_key='bookingCancelled' THEN 'Бронирование отменено' ELSE 'Бронирование изменено' END;
    END IF;
    IF event_key IS NOT NULL THEN category:='newBookings';path:='/bookings'; END IF;
  ELSIF TG_TABLE_NAME='individual_transfer_requests' AND TG_OP<>'DELETE' THEN
    IF TG_OP='INSERT' THEN event_key:='requestCreated';title:='Новая индивидуальная заявка';
    ELSIF item->>'status' IS DISTINCT FROM previous->>'status' OR item->>'booking_id' IS DISTINCT FROM previous->>'booking_id' THEN event_key:='requestChanged';title:='Заявка обновлена'; END IF;
    IF event_key IS NOT NULL THEN category:='newRequests';path:='/requests';END IF;
  ELSIF TG_TABLE_NAME='trips' AND TG_OP<>'DELETE' THEN
    IF TG_OP='INSERT' OR item->>'driver_id' IS DISTINCT FROM previous->>'driver_id' THEN event_key:='tripAssigned';title:='Назначение рейса';
    ELSIF item->>'status' IS DISTINCT FROM previous->>'status' OR item->>'starts_at' IS DISTINCT FROM previous->>'starts_at' OR item->>'ends_at' IS DISTINCT FROM previous->>'ends_at' OR item->>'vehicle_id' IS DISTINCT FROM previous->>'vehicle_id' THEN
      event_key:=CASE WHEN workflow_status_phase(company,'trips',item->>'status')='cancelled' THEN 'tripCancelled' ELSE 'tripChanged' END;
      title:=CASE WHEN event_key='tripCancelled' THEN 'Рейс отменён' ELSE 'Рейс изменён' END;
    END IF;
    IF event_key IS NOT NULL THEN category:='trips';path:='/trips';END IF;
  ELSIF TG_TABLE_NAME='payments' AND category IS NOT NULL THEN
    event_key:=CASE WHEN workflow_status_phase(company,'payments',item->>'status')='paid' THEN 'paymentPaid' WHEN workflow_status_phase(company,'payments',item->>'status') IN ('failed','cancelled') THEN 'paymentFailed' ELSE 'paymentChanged' END;
  ELSIF TG_TABLE_NAME='memberships' AND TG_OP='UPDATE' AND (item->>'role' IS DISTINCT FROM previous->>'role' OR item->>'is_active' IS DISTINCT FROM previous->>'is_active') THEN
    category:='team';event_key:='teamChanged';title:='Доступ сотрудника изменён';path:='/team';
  END IF;
  INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES(company,TG_TABLE_NAME,driver_member) RETURNING id INTO event;
  IF category IS NOT NULL THEN
    INSERT INTO app_notifications(event_id,membership_id,category,title,body,url,event_type)
      SELECT event,m.id,category,title,body,CASE WHEN m.role='driver' THEN '/driver' ELSE path END,coalesce(event_key,'')
      FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.tenant_id=company AND m.is_active AND NOT u.is_system AND (
        (m.role IN ('owner','admin','developer')) OR (m.role='accountant' AND category='payments') OR
        (m.role='dispatcher' AND category IN ('newRequests','newBookings','trips')) OR
        (m.role='driver' AND m.id=driver_member AND category IN ('trips','newBookings')));
    INSERT INTO push_jobs(notification_id,subscription_id)
      SELECT n.id,s.id FROM app_notifications n JOIN push_subscriptions s ON s.membership_id=n.membership_id WHERE n.event_id=event;
  END IF;
  -- Reassigned drivers must also invalidate their previous trip screen (no sensitive payload).
  IF TG_TABLE_NAME='trips' AND TG_OP='UPDATE' AND item->>'driver_id' IS DISTINCT FROM previous->>'driver_id' THEN
    SELECT membership_id INTO driver_member FROM drivers WHERE id=(previous->>'driver_id')::uuid AND tenant_id=company;
    IF driver_member IS NOT NULL THEN INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES(company,'trips',driver_member); END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION capture_finance_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END; company uuid:=(item->>'tenant_id')::uuid; driver_member uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=company) THEN RETURN NULL;END IF;
 IF item->>'driver_id' IS NOT NULL THEN SELECT membership_id INTO driver_member FROM drivers WHERE id=(item->>'driver_id')::uuid AND tenant_id=company;END IF;
 INSERT INTO realtime_events(tenant_id,entity,driver_membership_id) VALUES(company,'finance',driver_member);
 RETURN NULL;
END $$;
DO $$ DECLARE entity text;BEGIN
 FOREACH entity IN ARRAY ARRAY['driver_cash_ledger','driver_cash_handovers','driver_payroll_accruals','driver_payroll_payouts','operational_expenses','company_cash_receipts','finance_settings','bank_statement_transactions','finance_review_marks'] LOOP
 EXECUTE format('CREATE TRIGGER finance_event AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capture_finance_event()',entity);
 END LOOP;
END $$;
