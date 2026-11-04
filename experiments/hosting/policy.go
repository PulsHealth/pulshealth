package hosting

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
)

// A blind gateway cannot validate health semantics in private mode. Traditional
// uploads are inspectable, so enforce the experiment's raw-only collection scope
// before forwarding. The real ingest still performs full protocol validation.
func validateTraditional(compressed []byte, spec Spec) error {
	plain, e := Inflate(compressed)
	if e != nil {
		return e
	}
	allowed := map[string]bool{}
	for _, id := range spec.Types {
		allowed[id] = true
	}
	lines := bytes.Split(bytes.TrimSpace(plain), []byte{'\n'})
	if len(lines) < 1 {
		return errors.New("missing header")
	}
	var header struct {
		SchemaVersion int `json:"schemaVersion"`
	}
	if json.Unmarshal(lines[0], &header) != nil || header.SchemaVersion != 1 {
		return errors.New("invalid header")
	}
	for _, line := range lines[1:] {
		var record map[string]json.RawMessage
		if json.Unmarshal(line, &record) != nil {
			return errors.New("invalid record")
		}
		for _, key := range []string{"profile", "route", "series", "aggregate"} {
			if _, present := record[key]; present {
				return errors.New("unsupported collection payload")
			}
		}
		if deletion, present := record["deleted"]; present {
			var v struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(deletion, &v) != nil || !allowed[v.Type] {
				return errors.New("unapproved deletion type")
			}
			continue
		}
		if _, present := record["activitySummary"]; present {
			// Ring collection requires day/calendar consent handling beyond this raw
			// prototype. It is refused at program creation too.
			return errors.New("activity rings not enabled in this experiment")
		}
		var sample struct {
			Type  string   `json:"type"`
			Start *float64 `json:"start"`
		}
		if json.Unmarshal(line, &sample) != nil || !allowed[sample.Type] || sample.Start == nil || math.IsNaN(*sample.Start) || math.IsInf(*sample.Start, 0) || *sample.Start < float64(spec.StartMs) {
			return errors.New("unapproved sample scope")
		}
	}
	return nil
}
