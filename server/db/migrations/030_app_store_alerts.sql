-- Operator financial-event delivery receipts, independent of health/accounts.
-- No customer ID, receipt, transaction, price or signed payload is retained.
CREATE TABLE IF NOT EXISTS auth.app_store_alerts (
  event_hash bytea PRIMARY KEY CHECK (octet_length(event_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS app_store_alerts_created_idx ON auth.app_store_alerts(created_at);
REVOKE ALL ON auth.app_store_alerts FROM PUBLIC;
