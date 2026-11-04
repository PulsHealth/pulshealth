package hosting

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Cursor belongs to one source/participant/key. It advances only after the
// customer ingest acknowledges the whole original page. Replaying after a crash
// relies on the existing receiver's UUID deduplication and aggregate upserts.
type Cursor struct {
	Destination          string `json:"destination"`
	Server               string `json:"server"`
	Participant          string `json:"participant"`
	RecipientFingerprint string `json:"recipientFingerprint"`
	Sequence             int64  `json:"sequence"`
}

func LoadCursor(path string, expected Cursor) (Cursor, error) {
	b, e := os.ReadFile(path)
	if errors.Is(e, os.ErrNotExist) {
		return expected, nil
	}
	if e != nil {
		return expected, e
	}
	var stored Cursor
	if e = json.Unmarshal(b, &stored); e != nil {
		return expected, e
	}
	if stored.Destination != expected.Destination || stored.Server != expected.Server || stored.Participant != expected.Participant || stored.RecipientFingerprint != expected.RecipientFingerprint || stored.Sequence < 0 {
		return expected, errors.New("cursor belongs to another source, participant or key")
	}
	return stored, nil
}
func SaveCursor(path string, cursor Cursor) error {
	b, e := json.Marshal(cursor)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".vault-cursor-*")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if e = os.Rename(name, path); e != nil {
		return e
	}
	dir, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}
func ImportPage(ctx context.Context, endpoint, token, participant string, plaintext []byte) error {
	normalized, e := NormalizeEndpoint(endpoint)
	if e != nil || len(token) < 1 {
		return errors.New("invalid customer ingest URL or missing credential")
	}
	u, _ := url.Parse(normalized)
	if !uuidPattern.MatchString(participant) || len(plaintext) > MaxPlaintext {
		return errors.New("invalid participant or page")
	}
	var compressed bytes.Buffer
	g := gzip.NewWriter(&compressed)
	if _, e = g.Write(plaintext); e != nil {
		return e
	}
	if e = g.Close(); e != nil {
		return e
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/v1/batches"
	req, e := http.NewRequestWithContext(ctx, "POST", u.String(), bytes.NewReader(compressed.Bytes()))
	if e != nil {
		return e
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-User-ID", participant)
	req.Header.Set("X-Puls-Protocol", "1")
	req.Header.Set("Content-Encoding", "gzip")
	req.Header.Set("Content-Type", "application/x-ndjson")
	client := http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return errors.New("customer ingest request failed")
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("customer ingest HTTP %d", resp.StatusCode)
	}
	return nil
}

// NormalizeEndpoint rejects URL tricks before any bearer credential is attached.
// HTTP is confined to actual loopback hosts, not a textual URL prefix.
func NormalizeEndpoint(raw string) (string, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return "", errors.New("invalid endpoint")
	}
	host := strings.ToLower(u.Hostname())
	if u.Scheme != "https" && !(u.Scheme == "http" && (host == "127.0.0.1" || host == "localhost" || host == "::1")) {
		return "", errors.New("endpoint must use HTTPS (loopback HTTP permitted)")
	}
	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String(), nil
}
