CREATE TABLE money_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 owner_type text NOT NULL CHECK(owner_type IN ('company','member','driver','system')), owner_id uuid NOT NULL,
 currency char(3) NOT NULL CHECK(currency IN ('UAH','EUR','PLN','USD')),
 UNIQUE(tenant_id,owner_type,owner_id,currency), UNIQUE(tenant_id,id,currency)
);
CREATE TABLE money_journal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 actor_membership_id uuid, kind text NOT NULL, category text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '', trip_id uuid, booking_id uuid, occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), source_key text NOT NULL,
 UNIQUE(tenant_id,source_key), UNIQUE(tenant_id,id)
);
CREATE TABLE money_postings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 journal_id uuid NOT NULL,account_id uuid NOT NULL,currency char(3) NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor<>0),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES money_journal(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,account_id,currency) REFERENCES money_accounts(tenant_id,id,currency) ON DELETE CASCADE
);
CREATE INDEX money_postings_wallet_idx ON money_postings(tenant_id,account_id);
CREATE INDEX money_journal_date_idx ON money_journal(tenant_id,occurred_at DESC,id);
CREATE TABLE money_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 account_id uuid NOT NULL,recipient_account_id uuid NOT NULL,currency char(3) NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled')),
 requested_by uuid NOT NULL, resolved_by uuid, description text NOT NULL DEFAULT '',trip_id uuid,
 occurred_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,
 FOREIGN KEY(tenant_id,account_id,currency) REFERENCES money_accounts(tenant_id,id,currency),
 FOREIGN KEY(tenant_id,recipient_account_id,currency) REFERENCES money_accounts(tenant_id,id,currency),
 CHECK(account_id<>recipient_account_id)
);
CREATE INDEX money_transfers_pending_idx ON money_transfers(tenant_id,account_id) WHERE status='pending';
CREATE TABLE money_requests (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,request_id uuid NOT NULL,actor_membership_id uuid NOT NULL,
 request_hash bytea NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,request_id)
);
CREATE TABLE money_rate_history (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,rate_date date NOT NULL,currency char(3) NOT NULL CHECK(currency IN ('UAH','PLN','EUR','USD')),
 rate_to_uah numeric(30,12) NOT NULL CHECK(rate_to_uah>0),source text NOT NULL,description text NOT NULL DEFAULT '',actor_membership_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,rate_date,currency)
);
CREATE TABLE money_valuations (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,journal_id uuid NOT NULL,reporting_currency char(3) NOT NULL,
 rate numeric(30,12) NOT NULL CHECK(rate>0),amount_minor bigint NOT NULL,source text NOT NULL,
 FOREIGN KEY(tenant_id,journal_id) REFERENCES money_journal(tenant_id,id) ON DELETE CASCADE,
 PRIMARY KEY(tenant_id,journal_id,reporting_currency)
);
CREATE TABLE money_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,journal_id uuid PRIMARY KEY,booking_id uuid NOT NULL,
 account_id uuid NOT NULL,currency char(3) NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),
 booking_currency char(3) NOT NULL,settled_minor bigint NOT NULL CHECK(settled_minor>0),rate numeric(30,12) NOT NULL CHECK(rate>0),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES money_journal(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,account_id,currency) REFERENCES money_accounts(tenant_id,id,currency)
);
CREATE TABLE money_reversals (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,journal_id uuid PRIMARY KEY,reversal_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,journal_id) REFERENCES money_journal(tenant_id,id),
 FOREIGN KEY(tenant_id,reversal_id) REFERENCES money_journal(tenant_id,id)
);
ALTER TABLE operational_expenses ADD COLUMN wallet_account_id uuid REFERENCES money_accounts(id);
ALTER TABLE operational_expenses DROP CONSTRAINT operational_expenses_category_check;
ALTER TABLE operational_expenses ADD CONSTRAINT operational_expenses_category_check CHECK(category IN ('fuel','driver_pay','payroll_tax','amortization','marketing','other','wash','tolls','supplies','staff_pay','crew_pay'));

CREATE FUNCTION money_account(p_tenant uuid,p_type text,p_owner uuid,p_currency text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid;
BEGIN
 IF p_type IN ('company','system') AND p_owner<>p_tenant OR p_type='member' AND NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=p_tenant AND id=p_owner) OR p_type='driver' AND NOT EXISTS(SELECT 1 FROM drivers WHERE tenant_id=p_tenant AND id=p_owner) THEN
  RAISE EXCEPTION 'Wallet owner belongs to another company' USING ERRCODE='23514';
 END IF;
 INSERT INTO money_accounts(tenant_id,owner_type,owner_id,currency) VALUES(p_tenant,p_type,p_owner,p_currency) ON CONFLICT DO NOTHING;
 SELECT id INTO result FROM money_accounts WHERE tenant_id=p_tenant AND owner_type=p_type AND owner_id=p_owner AND currency=p_currency;
 RETURN result;
END $$;

CREATE FUNCTION money_bridge(p_table text,p_item jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE company uuid:=(p_item->>'tenant_id')::uuid; amount bigint:=(p_item->>'amount_minor')::bigint;
 c text:=p_item->>'currency'; actor uuid:=NULLIF(p_item->>'actor_membership_id','')::uuid;
 at_time timestamptz:=coalesce(NULLIF(p_item->>'occurred_at','')::timestamptz,now());
 member_id uuid; owner_id uuid; owner_kind text; wallet uuid; counter_wallet uuid; journal uuid; movement text; cat text:=coalesce(p_item->>'category',''); trip uuid:=NULLIF(p_item->>'trip_id','')::uuid;
BEGIN
 IF c NOT IN ('UAH','PLN','EUR','USD') OR amount=0 THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=company) THEN RETURN NULL; END IF;
 PERFORM id FROM tenants WHERE id=company FOR UPDATE;
 counter_wallet:=money_account(company,'system',company,c);
 IF p_table='driver_cash_ledger' THEN
  member_id:=NULLIF(p_item->>'collector_membership_id','')::uuid;
  IF member_id IS NULL THEN SELECT membership_id INTO member_id FROM drivers WHERE tenant_id=company AND id=(p_item->>'driver_id')::uuid; END IF;
  owner_kind:=CASE WHEN member_id IS NOT NULL THEN 'member' ELSE 'driver' END;
  owner_id:=coalesce(member_id,NULLIF(p_item->>'driver_id','')::uuid);
  wallet:=money_account(company,owner_kind,owner_id,c);
  IF p_item->>'kind'='collection' THEN movement:='transfer';amount:=-amount;counter_wallet:=money_account(company,'company',company,c);
  ELSE movement:='receipt';END IF;
 ELSIF p_table='company_cash_receipts' THEN
  wallet:=money_account(company,'company',company,c);movement:=CASE WHEN p_item->>'kind'='income' THEN 'income' ELSE 'funding' END;
 ELSIF p_table='operational_expenses' THEN
  movement:='expense';amount:=-amount;
  IF NULLIF(p_item->>'wallet_account_id','') IS NOT NULL THEN
   SELECT id INTO wallet FROM money_accounts WHERE tenant_id=company AND id=(p_item->>'wallet_account_id')::uuid AND currency=c;
   IF wallet IS NULL THEN RAISE EXCEPTION 'Expense wallet mismatch' USING ERRCODE='23514'; END IF;
  ELSIF p_item->>'payment_source'='cash' THEN wallet:=money_account(company,'company',company,c);
  ELSE wallet:=counter_wallet;END IF;
 ELSE
  movement:=CASE WHEN p_table='driver_payroll_payouts' THEN 'salary_payment' ELSE 'tax_payment' END;amount:=-amount;
  IF p_item->>'payment_source'='cash' THEN wallet:=money_account(company,'company',company,c); ELSE wallet:=counter_wallet; END IF;
 END IF;
 INSERT INTO money_journal(tenant_id,actor_membership_id,kind,category,description,trip_id,occurred_at,source_key)
 VALUES(company,actor,movement,cat,coalesce(p_item->>'description',''),trip,at_time,p_table||':'||(p_item->>'id')) ON CONFLICT DO NOTHING RETURNING id INTO journal;
 IF journal IS NULL THEN SELECT id INTO journal FROM money_journal WHERE tenant_id=company AND source_key=p_table||':'||(p_item->>'id');RETURN journal; END IF;
 INSERT INTO money_postings(tenant_id,journal_id,account_id,currency,amount_minor) VALUES(company,journal,wallet,c,amount),(company,journal,counter_wallet,c,-amount);
 RETURN journal;
END $$;
CREATE FUNCTION money_bridge_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM money_bridge(TG_TABLE_NAME,to_jsonb(NEW));RETURN NEW;END $$;
CREATE TRIGGER money_bridge_cash AFTER INSERT ON driver_cash_ledger FOR EACH ROW EXECUTE FUNCTION money_bridge_trigger();
CREATE TRIGGER money_bridge_company AFTER INSERT ON company_cash_receipts FOR EACH ROW EXECUTE FUNCTION money_bridge_trigger();
CREATE TRIGGER money_bridge_expense AFTER INSERT ON operational_expenses FOR EACH ROW EXECUTE FUNCTION money_bridge_trigger();
CREATE TRIGGER money_bridge_salary AFTER INSERT ON driver_payroll_payouts FOR EACH ROW EXECUTE FUNCTION money_bridge_trigger();
CREATE TRIGGER money_bridge_tax AFTER INSERT ON finance_tax_payments FOR EACH ROW EXECUTE FUNCTION money_bridge_trigger();
SELECT money_bridge('driver_cash_ledger',to_jsonb(l)) FROM driver_cash_ledger l ORDER BY occurred_at,id;
SELECT money_bridge('company_cash_receipts',to_jsonb(l)) FROM company_cash_receipts l ORDER BY occurred_at,id;
SELECT money_bridge('operational_expenses',to_jsonb(l)) FROM operational_expenses l ORDER BY occurred_at,id;
SELECT money_bridge('driver_payroll_payouts',to_jsonb(l)) FROM driver_payroll_payouts l ORDER BY occurred_at,id;
SELECT money_bridge('finance_tax_payments',to_jsonb(l)) FROM finance_tax_payments l ORDER BY occurred_at,id;

CREATE FUNCTION money_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Money records are immutable; post a reversal' USING ERRCODE='23514';
END $$;
CREATE TRIGGER money_journal_immutable BEFORE UPDATE OR DELETE ON money_journal FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE TRIGGER money_postings_immutable BEFORE UPDATE OR DELETE ON money_postings FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE TRIGGER money_accounts_immutable BEFORE UPDATE OR DELETE ON money_accounts FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE TRIGGER money_rates_immutable BEFORE UPDATE OR DELETE ON money_rate_history FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE TRIGGER money_valuations_immutable BEFORE UPDATE OR DELETE ON money_valuations FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE TRIGGER money_receipts_immutable BEFORE UPDATE OR DELETE ON money_receipts FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE TRIGGER money_reversals_immutable BEFORE UPDATE OR DELETE ON money_reversals FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE TRIGGER money_requests_immutable BEFORE UPDATE OR DELETE ON money_requests FOR EACH ROW EXECUTE FUNCTION money_immutable();
CREATE FUNCTION money_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' OR OLD.status<>'pending' OR NEW.status NOT IN ('accepted','rejected','cancelled')
 OR (to_jsonb(OLD)-'status'-'resolved_by'-'resolved_at') IS DISTINCT FROM (to_jsonb(NEW)-'status'-'resolved_by'-'resolved_at')
 OR NEW.resolved_by IS NULL OR NEW.resolved_at IS NULL THEN
 RAISE EXCEPTION 'Transfer may only be resolved once without changing its terms' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER money_transfer_terms BEFORE UPDATE OR DELETE ON money_transfers FOR EACH ROW EXECUTE FUNCTION money_transfer_guard();
CREATE FUNCTION money_balanced() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM money_postings WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id GROUP BY currency HAVING sum(amount_minor)<>0) THEN
  RAISE EXCEPTION 'Unbalanced monetary transaction' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER money_balanced AFTER INSERT ON money_postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION money_balanced();
