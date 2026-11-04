package hosting

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Exercises the actual customer CLI against the gateway and the existing
// standalone Python/SQLite protocol receiver, including replay-safe import.
func TestIntegrationCLIToReferenceReceiver(t *testing.T) {
	dsn := os.Getenv("EXPERIMENT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("separate scratch DB required")
	}
	db, e := pgxpool.New(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	tmp := t.TempDir()
	binary := filepath.Join(tmp, "vaultctl")
	build := exec.Command("go", "build", "-o", binary, "./cmd/vaultctl")
	if b, e := build.CombinedOutput(); e != nil {
		t.Fatalf("build CLI: %v %s", e, b)
	}
	provision := Secret()
	s := &Service{DB: db, ProvisionToken: provision}
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	run := func(token string, args ...string) ([]byte, error) {
		cmd := exec.Command(binary, args...)
		cmd.Env = append(os.Environ(), "VAULT_URL="+server.URL, "VAULT_TOKEN="+token)
		return cmd.Output()
	}
	keyPath := filepath.Join(tmp, "customer.key")
	b, e := run("", "keygen", keyPath)
	if e != nil {
		t.Fatal(e)
	}
	var public map[string]string
	json.Unmarshal(b, &public)
	spec := Spec{Name: "Synthetic CLI test", Kind: "individual", Mode: "private", RecipientKey: public["recipientKey"], Types: []string{"HKQuantityTypeIdentifierHeartRate", "HKCategoryTypeIdentifierSleepAnalysis"}, Consent: "Synthetic only", ConsentVersion: "1"}
	b, _ = json.Marshal(spec)
	specPath := filepath.Join(tmp, "spec.json")
	os.WriteFile(specPath, b, 0600)
	b, e = run(provision, "create", specPath)
	if e != nil {
		t.Fatal(e)
	}
	var created struct {
		ID    string `json:"id"`
		Token string `json:"managerToken"`
	}
	json.Unmarshal(b, &created)
	b, e = run(created.Token, "invite", created.ID, keyPath)
	if e != nil {
		t.Fatal(e)
	}
	var invite map[string]string
	json.Unmarshal(b, &invite)
	if !strings.Contains(invite["joinURL"], "mode=private") || !strings.Contains(invite["joinURL"], "key=") {
		t.Fatal("missing independent mode/key pin")
	}
	token := Secret()
	enrollRaw, _ := json.Marshal(map[string]string{"code": invite["code"], "token": token, "consentVersion": "1"})
	req := httptest.NewRequest("POST", "/v1/enrollments", bytes.NewReader(enrollRaw))
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("enroll", w.Code)
	}
	var enrolled struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &enrolled)
	defer func() {
		ctx := context.Background()
		for _, table := range []string{"commits", "objects"} {
			_, _ = db.Exec(ctx, "DELETE FROM "+table+" WHERE participant_id=$1", enrolled.ID)
		}
		_, _ = db.Exec(ctx, "DELETE FROM invitations WHERE program_id=$1", created.ID)
		_, _ = db.Exec(ctx, "DELETE FROM participants WHERE program_id=$1", created.ID)
		_, _ = db.Exec(ctx, "DELETE FROM programs WHERE id=$1", created.ID)
	}()
	fixture, e := os.ReadFile("../../docs/protocol/fixtures/01-quantity-category.ndjson")
	if e != nil {
		t.Fatal(e)
	}
	var compressed bytes.Buffer
	g := gzip.NewWriter(&compressed)
	g.Write(fixture)
	g.Close()
	publicKey, _ := base64.StdEncoding.DecodeString(public["recipientKey"])
	commit := Commit{ID: UUID(), Objects: []string{UUID()}}
	sealed, e := Seal(publicKey, compressed.Bytes(), Context(enrolled.ID, commit.ID, 0))
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(context.Background(), "INSERT INTO objects(participant_id,id,body,digest) VALUES($1,$2,$3,$4)", enrolled.ID, commit.Objects[0], sealed, hash(string(sealed)))
	if e != nil {
		t.Fatal(e)
	}
	objects, _ := json.Marshal(commit.Objects)
	_, e = db.Exec(context.Background(), "INSERT INTO commits(participant_id,id,sequence,objects) VALUES($1,$2,1,$3)", enrolled.ID, commit.ID, objects)
	if e != nil {
		t.Fatal(e)
	}
	b, e = run(created.Token, "read", enrolled.ID, keyPath)
	if e != nil {
		t.Fatal(e)
	}
	var event struct {
		NDJSON string `json:"ndjson"`
	}
	json.Unmarshal(b, &event)
	if event.NDJSON != string(fixture) {
		t.Fatal("decrypted page differs from protocol fixture")
	}
	// A wrong customer key must not produce an invitation from a substituted gateway key.
	wrong := filepath.Join(tmp, "wrong.key")
	if _, e = run("", "keygen", wrong); e != nil {
		t.Fatal(e)
	}
	if _, e = run(created.Token, "invite", created.ID, wrong); e == nil {
		t.Fatal("gateway/local key mismatch accepted")
	}

	// An individual workspace cannot enroll a second device/participant even
	// with another valid invitation; multi-device key enrollment is future work.
	b, e = run(created.Token, "invite", created.ID, keyPath)
	if e != nil {
		t.Fatal(e)
	}
	var secondInvite map[string]string
	json.Unmarshal(b, &secondInvite)
	secondBody, _ := json.Marshal(map[string]string{"code": secondInvite["code"], "token": Secret(), "consentVersion": "1"})
	secondRequest := httptest.NewRequest("POST", "/v1/enrollments", bytes.NewReader(secondBody))
	secondResponse := httptest.NewRecorder()
	s.Handler().ServeHTTP(secondResponse, secondRequest)
	if secondResponse.Code != 409 {
		t.Fatal("individual admitted another enrollment", secondResponse.Code)
	}
	// An unused expired invitation cannot be reviewed or consumed.
	_, e = db.Exec(context.Background(), "UPDATE invitations SET expires_at=now()-interval '1 second' WHERE hash=$1", hash(secondInvite["code"]))
	if e != nil {
		t.Fatal(e)
	}
	expiredRequest := httptest.NewRequest("POST", "/v1/enrollments", bytes.NewReader(secondBody))
	expiredResponse := httptest.NewRecorder()
	s.Handler().ServeHTTP(expiredResponse, expiredRequest)
	if expiredResponse.Code != 409 {
		t.Fatal("expired invitation accepted")
	}
	// Run the real reference receiver on an automatically selected loopback port.
	py := `import importlib.util,sys,threading,sqlite3
spec=importlib.util.spec_from_file_location('receiver','../../examples/receivers/python-sqlite/receiver.py')
m=importlib.util.module_from_spec(spec);sys.modules['receiver']=m;spec.loader.exec_module(m)
db=sqlite3.connect(sys.argv[1],check_same_thread=False);db.executescript(m.SCHEMA)
server=m.ThreadingHTTPServer(('127.0.0.1',0),m.Handler)
server.token,server.db,server.lock=sys.argv[2],db,threading.Lock()
print('http://127.0.0.1:'+str(server.server_address[1]),flush=True)
server.serve_forever()`
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	receiver := exec.CommandContext(ctx, "python3", "-u", "-c", py, filepath.Join(tmp, "receiver.sqlite"), "customer-secret")
	stdout, e := receiver.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	if e = receiver.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { cancel(); _ = receiver.Wait() }()
	address, e := bufio.NewReader(stdout).ReadString('\n')
	if e != nil {
		t.Fatal(e)
	}
	address = strings.TrimSpace(address)
	cursorPath := filepath.Join(tmp, "cursor.json")
	for i := 0; i < 2; i++ {
		cmd := exec.Command(binary, "import", enrolled.ID, keyPath, cursorPath)
		cmd.Env = append(os.Environ(), "VAULT_URL="+server.URL, "VAULT_TOKEN="+created.Token, "CONNECTOR_INGEST_URL="+address, "CONNECTOR_INGEST_TOKEN=customer-secret")
		if output, e := cmd.CombinedOutput(); e != nil {
			t.Fatalf("customer import: %v %s", e, output)
		}
	}
	stored, e := os.ReadFile(cursorPath)
	if e != nil {
		t.Fatal(e)
	}
	var cursor Cursor
	if e = json.Unmarshal(stored, &cursor); e != nil || cursor.Sequence != 1 || cursor.Destination != address {
		t.Fatal("import cursor did not bind target/ack", e)
	}
	verify := exec.Command("python3", "-c", `import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);assert db.execute('SELECT count(*) FROM samples').fetchone()[0]==3;assert db.execute('SELECT count(*) FROM batches').fetchone()[0]==1;assert db.execute('SELECT DISTINCT user_id FROM samples').fetchone()[0]==sys.argv[2]`, filepath.Join(tmp, "receiver.sqlite"), enrolled.ID)
	if output, e := verify.CombinedOutput(); e != nil {
		t.Fatalf("receiver readback: %v %s", e, output)
	}
}
