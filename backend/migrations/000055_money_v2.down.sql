DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM money_requests) THEN RAISE EXCEPTION 'Cannot discard recorded money operations'; END IF;
END $$;
DROP TRIGGER money_bridge_cash ON driver_cash_ledger;
DROP TRIGGER money_bridge_company ON company_cash_receipts;
DROP TRIGGER money_bridge_expense ON operational_expenses;
DROP TRIGGER money_bridge_salary ON driver_payroll_payouts;
DROP TRIGGER money_bridge_tax ON finance_tax_payments;
ALTER TABLE operational_expenses DROP COLUMN wallet_account_id;
DROP TABLE money_reversals,money_receipts,money_valuations,money_rate_history,money_requests,money_transfers,money_postings,money_journal,money_accounts CASCADE;
DROP FUNCTION money_bridge_trigger(),money_bridge(text,jsonb),money_account(uuid,text,uuid,text),money_balanced(),money_immutable(),money_transfer_guard();
