// vaultctl runs on the customer's computer. Never put a private key on the gateway.
package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	hosting "github.com/PulsHealth/pulshealth/experiments/hosting"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func request(method, path string, body any) ([]byte, error) {
	base, e := hosting.NormalizeEndpoint(os.Getenv("VAULT_URL"))
	if e != nil {
		return nil, e
	}
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, e := http.NewRequest(method, base+path, bytes.NewReader(raw))
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("VAULT_TOKEN"))
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return nil, errors.New("request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 2<<20))
}
func run() error {
	if len(os.Args) < 2 {
		return errors.New("usage: vaultctl keygen PRIVATE_FILE | create SPEC_FILE | invite PROGRAM PRIVATE_KEY_FILE_OR_--traditional | participants PROGRAM | revoke PARTICIPANT | close PROGRAM | read PARTICIPANT PRIVATE_FILE [AFTER_SEQUENCE] | import PARTICIPANT PRIVATE_FILE CURSOR_FILE")
	}
	args := os.Args[2:]
	switch os.Args[1] {
	case "keygen":
		if len(args) != 1 {
			return errors.New("keygen requires a new private file")
		}
		key, e := ecdh.X25519().GenerateKey(rand.Reader)
		if e != nil {
			return e
		}
		f, e := os.OpenFile(args[0], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		_, e = f.WriteString(base64.StdEncoding.EncodeToString(key.Bytes()) + "\n")
		ce := f.Close()
		if e != nil {
			return e
		}
		if ce != nil {
			return ce
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"recipientKey": base64.StdEncoding.EncodeToString(key.PublicKey().Bytes()), "fingerprint": hosting.Fingerprint(key.PublicKey().Bytes())})
	case "create":
		if len(args) != 1 {
			return errors.New("create requires a spec file")
		}
		b, e := os.ReadFile(args[0])
		if e != nil {
			return e
		}
		var v hosting.Spec
		if e = json.Unmarshal(b, &v); e != nil {
			return e
		}
		b, e = request("POST", "/v1/programs", v)
		if e != nil {
			return e
		}
		fmt.Println(string(b))
		return nil
	case "invite", "participants", "revoke", "close":
		if (os.Args[1] == "invite" && len(args) != 2) || (os.Args[1] != "invite" && len(args) != 1) {
			return errors.New("invite requires PROGRAM PRIVATE_KEY_FILE (or --traditional); other commands require one ID")
		}
		var pinnedKey string
		if os.Args[1] == "invite" && args[1] != "--traditional" {
			raw, e := os.ReadFile(args[1])
			if e != nil {
				return e
			}
			private, e := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
			if e != nil {
				return e
			}
			key, e := ecdh.X25519().NewPrivateKey(private)
			if e != nil {
				return e
			}
			pinnedKey = base64.StdEncoding.EncodeToString(key.PublicKey().Bytes())
		}
		method, path := "POST", "/v1/programs/"+args[0]+"/invitations"
		switch os.Args[1] {
		case "participants":
			method = "GET"
			path = "/v1/programs/" + args[0] + "/participants"
		case "revoke":
			path = "/v1/participants/" + args[0] + "/revoke"
		case "close":
			path = "/v1/programs/" + args[0] + "/close"
		}
		b, e := request(method, path, nil)
		if e != nil {
			return e
		}
		if os.Args[1] == "invite" {
			var invitation struct {
				Code         string `json:"code"`
				RecipientKey string `json:"recipientKey"`
			}
			if e = json.Unmarshal(b, &invitation); e != nil {
				return e
			}
			if invitation.RecipientKey != pinnedKey {
				return errors.New("gateway recipient does not match the customer-held key; invitation withheld")
			}
			mode := "private"
			if args[1] == "--traditional" {
				mode = "traditional"
			}
			fragment := url.Values{"code": {invitation.Code}, "key": {pinnedKey}, "mode": {mode}, "program": {args[0]}}
			link := url.URL{Scheme: "puls", Host: "program", RawQuery: url.Values{"server": {os.Getenv("VAULT_URL")}}.Encode(), Fragment: fragment.Encode()}
			return json.NewEncoder(os.Stdout).Encode(map[string]string{"code": invitation.Code, "joinURL": link.String()})
		}
		fmt.Println(string(b))
		return nil
	case "read", "import":
		if len(args) < 2 || len(args) > 3 || (os.Args[1] == "import" && len(args) != 3) {
			return errors.New("read requires participant, private key file and optional cursor")
		}
		raw, e := os.ReadFile(args[1])
		if e != nil {
			return e
		}
		key, e := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if e != nil {
			return e
		}
		after := "0"
		var cursor hosting.Cursor
		if os.Args[1] == "import" {
			recipient, e := ecdh.X25519().NewPrivateKey(key)
			if e != nil {
				return e
			}
			destination, e := hosting.NormalizeEndpoint(os.Getenv("CONNECTOR_INGEST_URL"))
			if e != nil {
				return e
			}
			source, e := hosting.NormalizeEndpoint(os.Getenv("VAULT_URL"))
			if e != nil {
				return e
			}
			cursor, e = hosting.LoadCursor(args[2], hosting.Cursor{Destination: destination, Server: source, Participant: args[0], RecipientFingerprint: hosting.Fingerprint(recipient.PublicKey().Bytes())})
			if e != nil {
				return e
			}
			after = fmt.Sprint(cursor.Sequence)
		} else if len(args) == 3 {
			after = args[2]
		}
		base := "/v1/participants/" + args[0]
		for {
			b, e := request("GET", base+"/commits?after="+after, nil)
			if e != nil {
				return e
			}
			var commits []hosting.Commit
			if e = json.Unmarshal(b, &commits); e != nil {
				return e
			}
			if len(commits) == 0 {
				return nil
			}
			for _, c := range commits {
				var compressed []byte
				if len(c.Objects) < 1 || len(c.Objects) > hosting.MaxParts {
					return errors.New("invalid part count")
				}
				for i, id := range c.Objects {
					body, e := request("GET", base+"/objects/"+id, nil)
					if e != nil {
						return e
					}
					plain, e := hosting.Open(key, body, hosting.Context(args[0], c.ID, i))
					if e != nil {
						return errors.New("authentication failed; no page emitted")
					}
					compressed = append(compressed, plain...)
				}
				plain, e := hosting.Inflate(compressed)
				if e != nil {
					return e
				}
				// One verified page per output line. Customer materializers must deduplicate
				// UUIDs, apply tombstones and replace aggregate revisions, never blindly sum.
				event := struct {
					Participant string `json:"participant"`
					Sequence    int64  `json:"sequence"`
					NDJSON      string `json:"ndjson"`
				}{args[0], c.Sequence, string(plain)}
				if os.Args[1] == "import" {
					if e = hosting.ImportPage(context.Background(), os.Getenv("CONNECTOR_INGEST_URL"), os.Getenv("CONNECTOR_INGEST_TOKEN"), args[0], plain); e != nil {
						return e
					}
					cursor.Sequence = c.Sequence
					if e = hosting.SaveCursor(args[2], cursor); e != nil {
						return e
					}
					fmt.Fprintf(os.Stderr, "Imported committed page %d\n", c.Sequence)
				} else if e = json.NewEncoder(os.Stdout).Encode(event); e != nil {
					return e
				}
				after = fmt.Sprint(c.Sequence)
			}
		}
	default:
		return errors.New("unknown command")
	}
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
