package hosting

import (
	"bytes"
	"compress/gzip"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

func TestCryptoBoundary(t *testing.T) {
	key, _ := ecdh.X25519().GenerateKey(rand.Reader)
	aad := Context(UUID(), UUID(), 0)
	plaintext := []byte("synthetic records")
	body, e := Seal(key.PublicKey().Bytes(), plaintext, aad)
	if e != nil {
		t.Fatal(e)
	}
	out, e := Open(key.Bytes(), body, aad)
	if e != nil || !bytes.Equal(out, plaintext) {
		t.Fatal("roundtrip", e)
	}
	for _, bad := range [][]byte{Context(UUID(), UUID(), 0), append(aad, 'x')} {
		if _, e = Open(key.Bytes(), body, bad); e == nil {
			t.Fatal("context accepted")
		}
	}
	body[len(body)-1] ^= 1
	if _, e = Open(key.Bytes(), body, aad); e == nil {
		t.Fatal("tamper accepted")
	}
	if _, e = Open(key.Bytes(), []byte{1}, aad); e == nil {
		t.Fatal("truncated accepted")
	}
}
func TestInflate(t *testing.T) {
	var b bytes.Buffer
	g := gzip.NewWriter(&b)
	g.Write([]byte("synthetic"))
	g.Close()
	v, e := Inflate(b.Bytes())
	if e != nil || string(v) != "synthetic" {
		t.Fatal(e)
	}
	if _, e = Inflate([]byte("bad")); e == nil {
		t.Fatal("bad gzip")
	}
}

func TestSwiftCipherAcceptance(t *testing.T) {
	path := os.Getenv("VAULT_SWIFT_ENVELOPE")
	if path == "" {
		t.Skip("run tests/CipherAcceptance.swift first")
	}
	var fixture map[string]string
	b, e := os.ReadFile("testdata/cipher.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		t.Fatal(e)
	}
	key, _ := base64.StdEncoding.DecodeString(fixture["privateKey"])
	body, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	plain, e := Open(key, body, []byte(fixture["context"]))
	if e != nil || string(plain) != fixture["plaintext"] {
		t.Fatal("Go could not open Swift ciphertext", e)
	}
}
