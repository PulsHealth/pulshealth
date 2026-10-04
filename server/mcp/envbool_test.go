package main

import (
	"strings"
	"testing"
)

// The one spelling rule for on/off settings, shared by ingest, the API and
// the MCP server (and the web viewer): true/1/yes/on and false/0/no/off in
// any case, empty is the default, anything else is a startup error naming
// the variable.
func TestParseBoolEnv(t *testing.T) {
	for raw, want := range map[string]bool{
		"true": true, " TRUE ": true, "True": true, "1": true, "yes": true, "Yes": true, "on": true, "ON": true,
		"false": false, "FALSE": false, "0": false, "no": false, "NO": false, "off": false, " Off ": false,
	} {
		for _, def := range []bool{false, true} {
			got, err := parseBoolEnv("TRUST_PROXY_HEADERS", raw, def)
			if err != nil || got != want {
				t.Errorf("parseBoolEnv(%q, default %v) = %v, %v; want %v, nil", raw, def, got, err, want)
			}
		}
	}
	for _, def := range []bool{false, true} {
		for _, raw := range []string{"", "   "} {
			if got, err := parseBoolEnv("TRUST_PROXY_HEADERS", raw, def); err != nil || got != def {
				t.Errorf("parseBoolEnv(%q, default %v) = %v, %v; want the default", raw, def, got, err)
			}
		}
	}
	// strconv.ParseBool's "t"/"f" are not accepted: one rule, the same one
	// the web viewer applies, not whatever each language's parser allows.
	for _, raw := range []string{"maybe", "t", "f", "enabled", "2", "true!", "y"} {
		_, err := parseBoolEnv("TRUST_PROXY_HEADERS", raw, false)
		if err == nil || !strings.Contains(err.Error(), "TRUST_PROXY_HEADERS") || !strings.Contains(err.Error(), raw) {
			t.Errorf("parseBoolEnv(%q) err = %v; want an error naming the variable and the value", raw, err)
		}
	}
}
