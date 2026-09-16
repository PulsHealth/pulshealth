package main

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func TestNewDeviceTokenShape(t *testing.T) {
	seen := map[string]bool{}
	for range 16 {
		tok, err := newDeviceToken()
		if err != nil {
			t.Fatal(err)
		}
		// Same shape as `openssl rand -hex 32`, so the app's token field, QR
		// payloads and the curl examples all stay as they are.
		if len(tok) != 2*deviceTokenBytes {
			t.Fatalf("token %q has length %d, want %d", tok, len(tok), 2*deviceTokenBytes)
		}
		if _, err := hex.DecodeString(tok); err != nil {
			t.Fatalf("token %q is not lowercase hex: %v", tok, err)
		}
		if strings.ToLower(tok) != tok {
			t.Fatalf("token %q is not lowercase", tok)
		}
		if seen[tok] {
			t.Fatalf("token %q drawn twice", tok)
		}
		seen[tok] = true
	}
}

func TestHashTokenIsDeterministicSHA256(t *testing.T) {
	a := hashToken("0123456789abcdef")
	b := hashToken("0123456789abcdef")
	if !bytes.Equal(a, b) {
		t.Fatal("same token hashed to different values")
	}
	if len(a) != 32 {
		t.Fatalf("hash length = %d, want 32 (the schema's CHECK)", len(a))
	}
	// Pinned so a change of hash function cannot silently invalidate every
	// stored token.
	if got := hex.EncodeToString(hashToken("abc")); got !=
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("hashToken(\"abc\") = %s, want the SHA-256 test vector", got)
	}
	if bytes.Equal(hashToken("abc"), hashToken("abd")) {
		t.Fatal("distinct tokens collided")
	}
}

func TestTokenPrefix(t *testing.T) {
	if got := tokenPrefix("0123456789abcdef"); got != "01234567" {
		t.Fatalf("prefix = %q", got)
	}
	if got := tokenPrefix("abc"); got != "abc" {
		t.Fatalf("short prefix = %q", got)
	}
}

func TestParseDevicesArgs(t *testing.T) {
	const user = "6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f"
	ok := []struct {
		args []string
		want devicesCommand
	}{
		{[]string{"list"}, devicesCommand{op: "list"}},
		{[]string{"list", "--all"}, devicesCommand{op: "list", all: true}},
		{[]string{"issue", "--user", user, "--name", "Sean's iPhone"},
			devicesCommand{op: "issue", userID: user, name: "Sean's iPhone"}},
		{[]string{"issue", "--name=Watch", "--user=" + user},
			devicesCommand{op: "issue", userID: user, name: "Watch"}},
		{[]string{"revoke", "7"}, devicesCommand{op: "revoke", id: 7}},
		{[]string{"rename", "7", "Old phone"}, devicesCommand{op: "rename", id: 7, name: "Old phone"}},
	}
	for _, c := range ok {
		got, err := parseDevicesArgs(c.args)
		if err != nil {
			t.Fatalf("%v: %v", c.args, err)
		}
		if got != c.want {
			t.Fatalf("%v = %+v, want %+v", c.args, got, c.want)
		}
	}

	bad := [][]string{
		{},
		{"approve", "1"},
		{"list", "--revoked"},
		{"issue"},
		{"issue", "--user", user},
		{"issue", "--name", "x"},
		{"issue", "--user", "not-a-uuid", "--name", "x"},
		{"issue", "--user", user, "--name"},
		{"issue", "--user", user, "--name", strings.Repeat("x", maxDeviceNameLen+1)},
		{"revoke"},
		{"revoke", "0"},
		{"revoke", "seven"},
		{"revoke", "1", "2"},
		{"rename", "1"},
		{"rename", "1", strings.Repeat("x", maxDeviceNameLen+1)},
	}
	for _, args := range bad {
		if _, err := parseDevicesArgs(args); err == nil {
			t.Fatalf("%v parsed without error", args)
		}
	}
}

func TestRunDevicesCLIUsageErrorExits2(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := runDevicesCLI([]string{"approve"}, &out, &errOut); code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	if !strings.Contains(errOut.String(), "usage: ingest devices") {
		t.Fatalf("stderr = %q, want the usage text", errOut.String())
	}
	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want nothing", out.String())
	}
}

func TestPrintDeviceTokens(t *testing.T) {
	var out bytes.Buffer
	printDeviceTokens(&out, nil, false)
	if !strings.Contains(out.String(), "No active device tokens") {
		t.Fatalf("empty listing = %q", out.String())
	}
	out.Reset()
	seen := time.Date(2026, 9, 15, 8, 30, 0, 0, time.UTC)
	printDeviceTokens(&out, []deviceToken{{
		ID: 3, UserID: "6f1c1f1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f", Name: "Phone",
		Status: "active", TokenPrefix: "0123abcd",
		CreatedAt: seen.Add(-24 * time.Hour), LastSeenAt: &seen,
	}}, false)
	for _, want := range []string{"ID", "PREFIX", "0123abcd…", "active", "Phone", "2026-09-15 08:30"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("listing %q lacks %q", out.String(), want)
		}
	}
	// The plaintext never appears anywhere: only its prefix is stored.
	if strings.Contains(out.String(), "0123abcd0") {
		t.Fatal("listing shows more than the prefix")
	}
}
