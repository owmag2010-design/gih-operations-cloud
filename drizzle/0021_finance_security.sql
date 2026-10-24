-- Finance: same-practice integrity, money checks, immutability of issued
-- invoices, and row-level security.
ALTER TABLE invoices ADD CONSTRAINT invoices_id_firm_uq UNIQUE (id, firm_id);--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_client_same_firm_fk FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_matter_same_firm_fk FOREIGN KEY (matter_id, firm_id) REFERENCES matters (id, firm_id);--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_proposal_same_firm_fk FOREIGN KEY (proposal_id, firm_id) REFERENCES proposals (id, firm_id);--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_invoice_same_firm_fk FOREIGN KEY (invoice_id, firm_id) REFERENCES invoices (id, firm_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_invoice_same_firm_fk FOREIGN KEY (invoice_id, firm_id) REFERENCES invoices (id, firm_id);--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_client_same_firm_fk FOREIGN KEY (client_id, firm_id) REFERENCES clients (id, firm_id);--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_invoice_same_firm_fk FOREIGN KEY (invoice_id, firm_id) REFERENCES invoices (id, firm_id);--> statement-breakpoint

ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_valid CHECK (
  subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0 AND total_minor >= 0 AND paid_minor >= 0 AND credited_minor >= 0
  AND total_minor = subtotal_minor - discount_minor + tax_minor
);--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_issued_has_number CHECK (status = 'draft' OR (status = 'void' AND issued_at IS NULL) OR (number IS NOT NULL AND issue_date IS NOT NULL AND due_date IS NOT NULL));--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT invoices_currency_valid CHECK (currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_amounts_valid CHECK (quantity > 0 AND (kind = 'discount' OR unit_minor >= 0) AND total_minor = quantity * unit_minor);--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount_minor > 0);--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_verified_has_verifier CHECK (status <> 'verified' OR (verified_at IS NOT NULL AND (verified_by_id IS NOT NULL OR verified_by IS NOT NULL)));--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_amount_positive CHECK (amount_minor > 0);--> statement-breakpoint
ALTER TABLE firm_billing ADD CONSTRAINT firm_billing_tax_valid CHECK (tax_rate_bp IS NULL OR tax_rate_bp BETWEEN 0 AND 5000);--> statement-breakpoint

-- An issued invoice can't be re-priced, renumbered or moved to another client.
CREATE OR REPLACE FUNCTION invoice_issued_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    IF OLD.status <> 'draft' AND (
      NEW.number IS DISTINCT FROM OLD.number OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
      OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
      OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.status = 'draft'
    ) THEN
      RAISE EXCEPTION 'An issued invoice cannot be changed; issue a credit note instead';
    END IF;
    RETURN NEW;
  END IF;
  -- invoice_lines
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id) AND i.status <> 'draft') THEN
    RAISE EXCEPTION 'Lines of an issued invoice cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;--> statement-breakpoint
CREATE TRIGGER invoices_issued_guard BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoice_issued_guard();--> statement-breakpoint
CREATE TRIGGER invoice_lines_issued_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_issued_guard();--> statement-breakpoint
REVOKE DELETE ON invoices, payments, credit_notes, payment_events FROM gih_app;--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firm_billing', 'invoices', 'invoice_lines', 'payments', 'credit_notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO gih_app USING (firm_id = ANY (app_firm_ids())) WITH CHECK (firm_id = ANY (app_firm_ids()))',
      t || '_firm_isolation', t
    );
  END LOOP;
END
$$;--> statement-breakpoint
-- Webhook log: written by the payment webhook (app.payments_system), readable within the practice.
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_events_access ON payment_events FOR ALL TO gih_app
  USING (current_setting('app.payments_system', true) = 'on' OR firm_id = ANY (app_firm_ids()))
  WITH CHECK (current_setting('app.payments_system', true) = 'on');
