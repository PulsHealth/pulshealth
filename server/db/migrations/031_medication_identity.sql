-- Optional device-local medication concept identity. Existing rows remain unchanged.
ALTER TABLE medication_dose_events ADD COLUMN IF NOT EXISTS medication_id text;
COMMENT ON COLUMN medication_dose_events.medication_id IS
    'Sender-assigned UUID for an opaque medication concept; scoped to its local identity map, not cross-device or reinstall stable';
