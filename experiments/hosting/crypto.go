// Package hosting is an isolated experimental hosting gateway and customer reader.
package hosting

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

const PartSize = 1 << 20
const MaxPlaintext = 256 << 20
const MaxParts = 256

func Context(participant, commit string, part int) []byte {
	return []byte(fmt.Sprintf("puls-vault-v1\n%s\n%s\n%d", participant, commit, part))
}

// Seal uses a fresh ephemeral X25519 key and random 96-bit nonce for each part.
// Wire: ephemeral public key (32) || nonce (12) || AES-256-GCM ciphertext+tag.
func Seal(public, plaintext, aad []byte) ([]byte, error) {
	if len(plaintext) > PartSize {
		return nil, errors.New("part too large")
	}
	recipient, err := ecdh.X25519().NewPublicKey(public)
	if err != nil {
		return nil, err
	}
	ephemeral, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	shared, err := ephemeral.ECDH(recipient)
	if err != nil {
		return nil, err
	}
	aead, err := derive(shared, aad)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	body := append(ephemeral.PublicKey().Bytes(), nonce...)
	return aead.Seal(body, nonce, plaintext, aad), nil
}
func derive(shared, aad []byte) (cipher.AEAD, error) {
	key, err := hkdf.Key(sha256.New, shared, []byte("puls-vault-v1"), string(aad), 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func Open(private, body, aad []byte) ([]byte, error) {
	if len(body) < 60 || len(body) > PartSize+60 {
		return nil, errors.New("invalid encrypted part size")
	}
	key, err := ecdh.X25519().NewPrivateKey(private)
	if err != nil {
		return nil, err
	}
	ephemeral, err := ecdh.X25519().NewPublicKey(body[:32])
	if err != nil {
		return nil, err
	}
	shared, err := key.ECDH(ephemeral)
	if err != nil {
		return nil, err
	}
	aead, err := derive(shared, aad)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, body[32:44], body[44:], aad)
}
func Fingerprint(public []byte) string {
	sum := sha256.Sum256(public)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func Inflate(compressed []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	b, err := io.ReadAll(io.LimitReader(r, MaxPlaintext+1))
	if err != nil {
		return nil, err
	}
	if len(b) > MaxPlaintext {
		return nil, errors.New("decompressed page exceeds limit")
	}
	return b, nil
}
