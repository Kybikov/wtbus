DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM driver_cash_ledger WHERE collector_membership_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Cannot discard staff cash history';
 END IF;
END $$;
CREATE OR REPLACE VIEW finance_ledger_entries AS
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
DROP TRIGGER cash_custodian_tenant ON driver_cash_ledger;
DROP FUNCTION check_cash_custodian_tenant();
DROP INDEX staff_cash_balance_idx;
ALTER TABLE driver_cash_ledger DROP CONSTRAINT cash_custodian_required;
ALTER TABLE driver_cash_ledger DROP COLUMN collector_membership_id;
ALTER TABLE driver_cash_ledger ALTER COLUMN driver_id SET NOT NULL;
