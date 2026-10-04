package main

import (
	"fmt"
	"strings"
)

// Boolean settings.
//
// One spelling rule for every on/off environment variable, identical in
// ingest, the product API and the MCP server (separate Go modules, so the
// function is copied; scripts/check-go-copies.sh fails CI on drift), and the
// rule the web viewer's lib/mode.ts follows: true/1/yes/on and
// false/0/no/off, in any case, surrounding space ignored; empty (unset or
// blank) is the setting's default. Anything else stops the service at
// startup with a message naming the variable. A typo must never quietly
// mean "off" in one service and "on" in another: TRUST_PROXY_HEADERS used to
// be parsed three different ways, and `yes` crashed ingest while the API
// read it as false.
func parseBoolEnv(name, raw string, def bool) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return def, nil
	case "true", "1", "yes", "on":
		return true, nil
	case "false", "0", "no", "off":
		return false, nil
	}
	return false, fmt.Errorf("%s must be true or false (also accepted: 1/0, yes/no, on/off), got %q",
		name, strings.TrimSpace(raw))
}
