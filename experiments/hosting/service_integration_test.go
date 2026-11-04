package hosting

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
)

func TestIntegrationLifecycle(t *testing.T) {
	dsn := os.Getenv("EXPERIMENT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("separate scratch database required")
	}
	db, e := pgxpool.New(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	provision := Secret()
	s := &Service{DB: db, ProvisionToken: provision}
	handler := s.Handler()
	call := func(method, path, token string, body any) (int, []byte) {
		t.Helper()
		var b []byte
		switch v := body.(type) {
		case []byte:
			b = v
		case nil:
		default:
			b, _ = json.Marshal(v)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(b))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code, w.Body.Bytes()
	}
	want := func(method, path, token string, body any, status int) []byte {
		t.Helper()
		code, b := call(method, path, token, body)
		if code != status {
			t.Fatalf("%s %s got %d want %d: %s", method, path, code, status, b)
		}
		return b
	}
	key, _ := ecdh.X25519().GenerateKey(rand.Reader)
	spec := Spec{Name: "Synthetic program", Kind: "program", Mode: "private", RecipientKey: base64.StdEncoding.EncodeToString(key.PublicKey().Bytes()), Types: []string{"HKQuantityTypeIdentifierStepCount"}, StartMs: 0, Consent: "Synthetic test only", ConsentVersion: "1"}
	var created struct {
		ID    string `json:"id"`
		Token string `json:"managerToken"`
	}
	json.Unmarshal(want("POST", "/v1/programs", provision, spec, 201), &created)
	program := created.ID
	manager := created.Token
	defer func() {
		ctx := context.Background()
		_, _ = db.Exec(ctx, "DELETE FROM commits WHERE participant_id IN (SELECT id FROM participants WHERE program_id=$1)", program)
		_, _ = db.Exec(ctx, "DELETE FROM objects WHERE participant_id IN (SELECT id FROM participants WHERE program_id=$1)", program)
		_, _ = db.Exec(ctx, "DELETE FROM invitations WHERE program_id=$1", program)
		_, _ = db.Exec(ctx, "DELETE FROM participants WHERE program_id=$1", program)
		_, _ = db.Exec(ctx, "DELETE FROM programs WHERE id=$1", program)
	}()
	var invitation struct {
		Code string `json:"code"`
	}
	json.Unmarshal(want("POST", "/v1/programs/"+program+"/invitations", manager, nil, 201), &invitation)
	want("POST", "/v1/invitations/review", "", map[string]string{"code": invitation.Code}, 200)
	token := Secret()
	enrollment := map[string]string{"code": invitation.Code, "token": token, "consentVersion": "1"}
	var participant struct {
		ID string `json:"id"`
	}
	json.Unmarshal(want("POST", "/v1/enrollments", "", enrollment, 200), &participant)
	first := want("POST", "/v1/enrollments", "", enrollment, 200)
	if !bytes.Contains(first, []byte(participant.ID)) {
		t.Fatal("unstable enrollment retry")
	}
	enrollment["token"] = Secret()
	want("POST", "/v1/enrollments", "", enrollment, 409)
	base := "/v1/participants/" + participant.ID
	want("GET", base+"/commits", token, nil, 403)
	want("GET", base+"/commits", provision, nil, 403)
	commit := Commit{ID: UUID(), Objects: []string{UUID(), UUID()}}
	// Reader sees nothing before all objects and metadata publish together.
	want("POST", base+"/commits", token, commit, 409)
	for i, id := range commit.Objects {
		sealed, e := Seal(key.PublicKey().Bytes(), []byte(fmt.Sprintf("synthetic-%d", i)), Context(participant.ID, commit.ID, i))
		if e != nil {
			t.Fatal(e)
		}
		want("PUT", base+"/objects/"+id, token, sealed, 200)
		want("PUT", base+"/objects/"+id, token, sealed, 200)
		want("GET", base+"/objects/"+id, manager, nil, 404)
		sealed[50] ^= 1
		want("PUT", base+"/objects/"+id, token, sealed, 409)
	}
	var receipt Commit
	json.Unmarshal(want("POST", base+"/commits", token, commit, 200), &receipt)
	if receipt.Sequence != 1 {
		t.Fatal("first sequence")
	}
	var retried Commit
	json.Unmarshal(want("POST", base+"/commits", token, commit, 200), &retried)
	if retried.Sequence != 1 {
		t.Fatal("retry advanced sequence")
	}
	changed := commit
	changed.Objects = []string{commit.Objects[0]}
	want("POST", base+"/commits", token, changed, 409)
	for i, id := range commit.Objects {
		body := want("GET", base+"/objects/"+id, manager, nil, 200)
		plain, e := Open(key.Bytes(), body, Context(participant.ID, commit.ID, i))
		if e != nil || string(plain) != fmt.Sprintf("synthetic-%d", i) {
			t.Fatal("customer decrypt", e)
		}
	}
	// Concurrent publishers have unique ordered cursors without lost appends.
	var wg sync.WaitGroup
	codes := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := Commit{ID: UUID(), Objects: commit.Objects}
			code, _ := call("POST", base+"/commits", token, c)
			codes <- code
		}()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatal("concurrent publish", code)
		}
	}
	var list []Commit
	json.Unmarshal(want("GET", base+"/commits?after=1", manager, nil, 200), &list)
	if len(list) != 12 || list[11].Sequence != 13 {
		t.Fatal("lost commits")
	}
	// Recreating the gateway over the database preserves its log.
	handler = (&Service{DB: db, ProvisionToken: provision}).Handler()
	want("GET", base+"/commits", manager, nil, 200)
	want("POST", base+"/revoke", manager, nil, 200)
	want("POST", base+"/leave", token, nil, 200)
	want("POST", base+"/leave", token, nil, 200)
	want("POST", base+"/leave", Secret(), nil, 403)
	want("PUT", base+"/objects/"+UUID(), token, make([]byte, 60), 403)
	want("POST", base+"/commits", token, commit, 403)
	want("GET", base+"/commits", manager, nil, 200) // retention is explicit; revocation is not erasure
	want("POST", "/v1/programs/"+program+"/close", manager, nil, 200)
	want("POST", base+"/leave", token, nil, 200)
	// Closed programs must never mint invitations, even for their manager.
	want("POST", "/v1/programs/"+program+"/invitations", manager, nil, 409)
}

func TestIntegrationTraditionalIsolation(t *testing.T) {
	dsn := os.Getenv("EXPERIMENT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("scratch DB required")
	}
	db, e := pgxpool.New(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	var receivedUser string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedUser = r.Header.Get("X-User-ID")
		if r.Header.Get("Authorization") != "Bearer upstream-secret" {
			t.Error("wrong upstream token")
		}
		io.Copy(io.Discard, r.Body)
		w.WriteHeader(200)
	}))
	defer upstream.Close()
	program, participant, token, manager := UUID(), UUID(), Secret(), Secret()
	raw, _ := json.Marshal(Spec{Mode: "traditional", Types: []string{"HKQuantityTypeIdentifierStepCount"}})
	_, e = db.Exec(context.Background(), "INSERT INTO programs(id,manager_hash,spec) VALUES($1,$2,$3)", program, hash(manager), raw)
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(context.Background(), "INSERT INTO participants(id,program_id,token_hash,consent_version) VALUES($1,$2,$3,'1')", participant, program, hash(token))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Exec(context.Background(), "DELETE FROM programs WHERE id=$1", program)
	defer db.Exec(context.Background(), "DELETE FROM participants WHERE id=$1", participant)
	handler := (&Service{DB: db, IngestURL: upstream.URL, IngestToken: "upstream-secret"}).Handler()
	var compressed bytes.Buffer
	g := gzip.NewWriter(&compressed)
	_, _ = g.Write([]byte("{\"schemaVersion\":1}\n{\"type\":\"HKQuantityTypeIdentifierStepCount\",\"start\":1000}\n"))
	_ = g.Close()
	request := httptest.NewRequest("POST", "/v1/participants/"+participant+"/v1/batches", bytes.NewReader(compressed.Bytes()))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-User-ID", UUID())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	if w.Code != 200 || receivedUser != participant {
		t.Fatalf("tenant selection: %d %q", w.Code, receivedUser)
	}
}
