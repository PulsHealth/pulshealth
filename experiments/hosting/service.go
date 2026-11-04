package hosting

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Spec is immutable after creation. Changes require a new program and consent.
type Spec struct {
	Name           string   `json:"name"`
	Kind           string   `json:"kind"`         // individual or program
	Mode           string   `json:"mode"`         // private or traditional
	RecipientKey   string   `json:"recipientKey"` // base64 X25519 public key; no private key
	Types          []string `json:"types"`
	StartMs        int64    `json:"startMs"`
	Consent        string   `json:"consent"`
	ConsentVersion string   `json:"consentVersion"`
}
type Commit struct {
	ID       string   `json:"id"`
	Sequence int64    `json:"sequence"`
	Objects  []string `json:"objects"`
}
type Service struct {
	DB             *pgxpool.Pool
	ProvisionToken string
	IngestURL      string
	IngestToken    string
	Client         *http.Client
}

var errUnauthorized = errors.New("unauthorized")

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func UUID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func Secret() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func hash(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func bearer(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int) {
	write(w, status, map[string]string{"error": http.StatusText(status)})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400)
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400)
		return false
	}
	return true
}
func (s *Service) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("POST /v1/programs", s.create)
	m.HandleFunc("POST /v1/programs/{program}/invitations", s.invite)
	m.HandleFunc("GET /v1/programs/{program}/participants", s.participants)
	m.HandleFunc("POST /v1/programs/{program}/close", s.closeProgram)
	// Invitation secrets are sent in bodies, never URL paths/query strings.
	m.HandleFunc("POST /v1/invitations/review", s.review)
	m.HandleFunc("POST /v1/enrollments", s.enroll)
	m.HandleFunc("POST /v1/participants/{participant}/leave", s.leave)
	m.HandleFunc("POST /v1/participants/{participant}/revoke", s.revoke)
	m.HandleFunc("PUT /v1/participants/{participant}/objects/{object}", s.putObject)
	m.HandleFunc("POST /v1/participants/{participant}/commits", s.commit)
	m.HandleFunc("GET /v1/participants/{participant}/commits", s.commits)
	m.HandleFunc("GET /v1/participants/{participant}/objects/{object}", s.getObject)
	m.HandleFunc("POST /v1/participants/{participant}/v1/batches", s.traditional)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		m.ServeHTTP(w, r)
	})
}
func validateSpec(v Spec) bool {
	if len(v.Name) < 1 || len(v.Name) > 120 || len(v.Consent) < 1 || len(v.Consent) > 10000 || len(v.ConsentVersion) < 1 || len(v.ConsentVersion) > 80 || v.StartMs < 0 || v.StartMs > time.Now().UnixMilli() || len(v.Types) < 1 || len(v.Types) > 200 {
		return false
	}
	if v.Kind != "program" && v.Kind != "individual" {
		return false
	}
	seen := map[string]bool{}
	for _, t := range v.Types {
		if t == "HKActivitySummaryTypeIdentifier" || !strings.HasPrefix(t, "HK") || len(t) > 160 || seen[t] {
			return false
		}
		seen[t] = true
	}
	if v.Mode == "traditional" {
		return v.RecipientKey == ""
	}
	if v.Mode != "private" {
		return false
	}
	k, e := base64.StdEncoding.DecodeString(v.RecipientKey)
	return e == nil && len(k) == 32 && !bytes.Equal(k, make([]byte, 32))
}
func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	if len(s.ProvisionToken) < 32 || subtle.ConstantTimeCompare([]byte(bearer(r)), []byte(s.ProvisionToken)) != 1 {
		fail(w, 401)
		return
	}
	var v Spec
	if !decode(w, r, &v) {
		return
	}
	if !validateSpec(v) {
		fail(w, 400)
		return
	}
	if v.Mode == "traditional" && (s.IngestURL == "" || s.IngestToken == "") {
		fail(w, 503)
		return
	}
	id, token := UUID(), Secret()
	raw, _ := json.Marshal(v)
	if _, e := s.DB.Exec(r.Context(), "INSERT INTO programs(id,manager_hash,spec) VALUES($1,$2,$3)", id, hash(token), raw); e != nil {
		fail(w, 503)
		return
	}
	write(w, 201, map[string]string{"id": id, "managerToken": token})
}
func (s *Service) manager(ctx context.Context, program, token string) bool {
	if !uuidPattern.MatchString(program) || len(token) < 32 {
		return false
	}
	var yes bool
	return s.DB.QueryRow(ctx, "SELECT true FROM programs WHERE id=$1 AND manager_hash=$2", program, hash(token)).Scan(&yes) == nil && yes
}
func (s *Service) invite(w http.ResponseWriter, r *http.Request) {
	p := r.PathValue("program")
	if !s.manager(r.Context(), p, bearer(r)) {
		fail(w, 403)
		return
	}
	code := Secret()
	result, e := s.DB.Exec(r.Context(), "INSERT INTO invitations(hash,program_id,expires_at) SELECT $1,id,now()+interval '24 hours' FROM programs WHERE id=$2 AND NOT closed", hash(code), p)
	if e != nil {
		fail(w, 503)
		return
	}
	if result.RowsAffected() != 1 {
		fail(w, 409)
		return
	}
	var raw []byte
	if e = s.DB.QueryRow(r.Context(), "SELECT spec FROM programs WHERE id=$1", p).Scan(&raw); e != nil {
		fail(w, 503)
		return
	}
	var spec Spec
	_ = json.Unmarshal(raw, &spec)
	write(w, 201, map[string]string{"code": code, "recipientKey": spec.RecipientKey})
}
func (s *Service) review(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &q) {
		return
	}
	var raw []byte
	var id string
	e := s.DB.QueryRow(r.Context(), "SELECT p.id,p.spec FROM invitations i JOIN programs p ON p.id=i.program_id WHERE i.hash=$1 AND i.expires_at>now() AND i.participant_id IS NULL AND NOT p.closed", hash(q.Code)).Scan(&id, &raw)
	if e != nil {
		fail(w, 404)
		return
	}
	write(w, 200, map[string]any{"id": id, "spec": json.RawMessage(raw)})
}
func (s *Service) enroll(w http.ResponseWriter, r *http.Request) {
	var q struct {
		Code           string `json:"code"`
		Token          string `json:"token"`
		ConsentVersion string `json:"consentVersion"`
	}
	if !decode(w, r, &q) {
		return
	}
	key, e := base64.RawURLEncoding.DecodeString(q.Token)
	if e != nil || len(key) != 32 {
		fail(w, 400)
		return
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		fail(w, 503)
		return
	}
	defer tx.Rollback(r.Context())
	var program string
	var existing *string
	var raw []byte
	// Program row lock serializes individual enrollment and closure with publication.
	e = tx.QueryRow(r.Context(), "SELECT p.id,p.spec,i.participant_id::text FROM invitations i JOIN programs p ON p.id=i.program_id WHERE i.hash=$1 AND (i.expires_at>now() OR i.participant_id IS NOT NULL) AND NOT p.closed FOR UPDATE OF p,i", hash(q.Code)).Scan(&program, &raw, &existing)
	if e != nil {
		fail(w, 409)
		return
	}
	var spec Spec
	_ = json.Unmarshal(raw, &spec)
	if q.ConsentVersion != spec.ConsentVersion {
		fail(w, 409)
		return
	}
	id := UUID()
	if existing != nil {
		id = *existing
		var found bool
		e = tx.QueryRow(r.Context(), "SELECT true FROM participants WHERE id=$1 AND token_hash=$2 AND NOT revoked", id, hash(q.Token)).Scan(&found)
		if e != nil || !found {
			fail(w, 409)
			return
		}
	} else {
		if spec.Kind == "individual" {
			var n int
			e = tx.QueryRow(r.Context(), "SELECT count(*) FROM participants WHERE program_id=$1", program).Scan(&n)
			if e != nil {
				fail(w, 503)
				return
			}
			if n > 0 {
				fail(w, 409)
				return
			}
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO participants(id,program_id,token_hash,consent_version) VALUES($1,$2,$3,$4)", id, program, hash(q.Token), q.ConsentVersion)
		if e == nil {
			_, e = tx.Exec(r.Context(), "UPDATE invitations SET participant_id=$1 WHERE hash=$2", id, hash(q.Code))
		}
		if e != nil {
			fail(w, 409)
			return
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, 503)
		return
	}
	write(w, 200, map[string]string{"id": id, "program": program})
}

// Lock participant and program for every write: revocation/closure cannot race an ack.
func (s *Service) writer(r *http.Request) (pgx.Tx, Spec, error) {
	var spec Spec
	id := r.PathValue("participant")
	if !uuidPattern.MatchString(id) || len(bearer(r)) < 32 {
		return nil, spec, errUnauthorized
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return nil, spec, e
	}
	var raw []byte
	e = tx.QueryRow(r.Context(), "SELECT g.spec FROM participants p JOIN programs g ON g.id=p.program_id WHERE p.id=$1 AND p.token_hash=$2 AND NOT p.revoked AND NOT g.closed FOR SHARE OF g FOR UPDATE OF p", id, hash(bearer(r))).Scan(&raw)
	if e != nil {
		tx.Rollback(r.Context())
		return nil, spec, e
	}
	e = json.Unmarshal(raw, &spec)
	return tx, spec, e
}
func (s *Service) reader(r *http.Request) bool {
	id := r.PathValue("participant")
	if !uuidPattern.MatchString(id) || len(bearer(r)) < 32 {
		return false
	}
	var found bool
	return s.DB.QueryRow(r.Context(), "SELECT true FROM participants p JOIN programs g ON g.id=p.program_id WHERE p.id=$1 AND g.manager_hash=$2", id, hash(bearer(r))).Scan(&found) == nil && found
}
func (s *Service) putObject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("object")
	if !uuidPattern.MatchString(id) {
		fail(w, 400)
		return
	}
	body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, PartSize+60))
	if e != nil || len(body) < 60 {
		fail(w, 413)
		return
	}
	tx, spec, e := s.writer(r)
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) || errors.Is(e, errUnauthorized) {
			fail(w, 403)
		} else {
			fail(w, 503)
		}
		return
	}
	defer tx.Rollback(r.Context())
	if spec.Mode != "private" {
		fail(w, 409)
		return
	}
	participant := r.PathValue("participant")
	digest := hash(string(body))
	var prior string
	e = tx.QueryRow(r.Context(), "SELECT digest FROM objects WHERE participant_id=$1 AND id=$2", participant, id).Scan(&prior)
	if e == nil {
		if prior != digest {
			fail(w, 409)
			return
		}
	} else if errors.Is(e, pgx.ErrNoRows) {
		var used int64
		e = tx.QueryRow(r.Context(), "SELECT stored_bytes FROM participants WHERE id=$1", participant).Scan(&used)
		if e != nil {
			fail(w, 503)
			return
		}
		if used+int64(len(body)) > 2<<30 {
			fail(w, 413)
			return
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO objects(participant_id,id,body,digest) VALUES($1,$2,$3,$4)", participant, id, body, digest)
		if e == nil {
			_, e = tx.Exec(r.Context(), "UPDATE participants SET stored_bytes=stored_bytes+$2 WHERE id=$1", participant, len(body))
		}
		if e != nil {
			fail(w, 503)
			return
		}
	} else {
		fail(w, 503)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, 503)
		return
	}
	write(w, 200, map[string]string{"id": id, "digest": digest})
}
func (s *Service) commit(w http.ResponseWriter, r *http.Request) {
	var q Commit
	if !decode(w, r, &q) {
		return
	}
	if !uuidPattern.MatchString(q.ID) || q.Sequence != 0 || len(q.Objects) < 1 || len(q.Objects) > MaxParts {
		fail(w, 400)
		return
	}
	seen := map[string]bool{}
	for _, id := range q.Objects {
		if !uuidPattern.MatchString(id) || seen[id] {
			fail(w, 400)
			return
		}
		seen[id] = true
	}
	tx, spec, e := s.writer(r)
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) || errors.Is(e, errUnauthorized) {
			fail(w, 403)
		} else {
			fail(w, 503)
		}
		return
	}
	defer tx.Rollback(r.Context())
	if spec.Mode != "private" {
		fail(w, 409)
		return
	}
	p := r.PathValue("participant")
	raw, _ := json.Marshal(q.Objects)
	var prior []byte
	e = tx.QueryRow(r.Context(), "SELECT sequence,objects FROM commits WHERE participant_id=$1 AND id=$2", p, q.ID).Scan(&q.Sequence, &prior)
	if e == nil {
		var ids []string
		_ = json.Unmarshal(prior, &ids)
		normalized, _ := json.Marshal(ids)
		if !bytes.Equal(raw, normalized) {
			fail(w, 409)
			return
		}
	} else if errors.Is(e, pgx.ErrNoRows) {
		for _, id := range q.Objects {
			var found bool
			e = tx.QueryRow(r.Context(), "SELECT true FROM objects WHERE participant_id=$1 AND id=$2", p, id).Scan(&found)
			if e != nil {
				fail(w, 409)
				return
			}
		}
		e = tx.QueryRow(r.Context(), "UPDATE participants SET sequence=sequence+1 WHERE id=$1 RETURNING sequence", p).Scan(&q.Sequence)
		if e == nil {
			_, e = tx.Exec(r.Context(), "INSERT INTO commits(participant_id,id,sequence,objects) VALUES($1,$2,$3,$4)", p, q.ID, q.Sequence, raw)
		}
		if e != nil {
			fail(w, 503)
			return
		}
	} else {
		fail(w, 503)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, 503)
		return
	}
	write(w, 200, q)
}
func (s *Service) commits(w http.ResponseWriter, r *http.Request) {
	if !s.reader(r) {
		fail(w, 403)
		return
	}
	var after int64
	if v := r.URL.Query().Get("after"); v != "" {
		if _, e := fmt.Sscan(v, &after); e != nil || after < 0 {
			fail(w, 400)
			return
		}
	}
	rows, e := s.DB.Query(r.Context(), "SELECT id,sequence,objects FROM commits WHERE participant_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100", r.PathValue("participant"), after)
	if e != nil {
		fail(w, 503)
		return
	}
	defer rows.Close()
	result := []Commit{}
	for rows.Next() {
		var c Commit
		var raw []byte
		if e = rows.Scan(&c.ID, &c.Sequence, &raw); e != nil {
			fail(w, 503)
			return
		}
		if e = json.Unmarshal(raw, &c.Objects); e != nil {
			fail(w, 503)
			return
		}
		result = append(result, c)
	}
	if rows.Err() != nil {
		fail(w, 503)
		return
	}
	write(w, 200, result)
}
func (s *Service) getObject(w http.ResponseWriter, r *http.Request) {
	if !s.reader(r) {
		fail(w, 403)
		return
	}
	id := r.PathValue("object")
	if !uuidPattern.MatchString(id) {
		fail(w, 400)
		return
	}
	var b []byte
	// Unpublished objects are never reader-visible.
	e := s.DB.QueryRow(r.Context(), "SELECT o.body FROM objects o WHERE o.participant_id=$1 AND o.id=$2 AND EXISTS(SELECT 1 FROM commits c WHERE c.participant_id=o.participant_id AND c.objects ? o.id::text)", r.PathValue("participant"), id).Scan(&b)
	if e != nil {
		fail(w, 404)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	_, _ = w.Write(b)
}
func (s *Service) participants(w http.ResponseWriter, r *http.Request) {
	p := r.PathValue("program")
	if !s.manager(r.Context(), p, bearer(r)) {
		fail(w, 403)
		return
	}
	rows, e := s.DB.Query(r.Context(), "SELECT id,revoked,sequence,stored_bytes FROM participants WHERE program_id=$1 ORDER BY joined_at LIMIT 1000", p)
	if e != nil {
		fail(w, 503)
		return
	}
	defer rows.Close()
	type participant struct {
		ID          string `json:"id"`
		Revoked     bool   `json:"revoked"`
		Sequence    int64  `json:"sequence"`
		StoredBytes int64  `json:"storedBytes"`
	}
	out := []participant{}
	for rows.Next() {
		var v participant
		if e = rows.Scan(&v.ID, &v.Revoked, &v.Sequence, &v.StoredBytes); e != nil {
			fail(w, 503)
			return
		}
		out = append(out, v)
	}
	if rows.Err() != nil {
		fail(w, 503)
		return
	}
	write(w, 200, out)
}
func (s *Service) leave(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("participant")
	if !uuidPattern.MatchString(id) || len(bearer(r)) < 32 {
		fail(w, 403)
		return
	}
	// The original credential can confirm withdrawal even after revocation or
	// closure. Lost responses must not strand the app in an enrollment forever.
	result, e := s.DB.Exec(r.Context(), "UPDATE participants SET revoked=true WHERE id=$1 AND token_hash=$2", id, hash(bearer(r)))
	if e != nil {
		fail(w, 503)
		return
	}
	if result.RowsAffected() != 1 {
		fail(w, 403)
		return
	}
	write(w, 200, map[string]bool{"revoked": true})
}
func (s *Service) revoke(w http.ResponseWriter, r *http.Request) {
	p := r.PathValue("participant")
	if !s.reader(r) {
		fail(w, 403)
		return
	}
	_, e := s.DB.Exec(r.Context(), "UPDATE participants SET revoked=true WHERE id=$1", p)
	if e != nil {
		fail(w, 503)
		return
	}
	write(w, 200, map[string]bool{"revoked": true})
}
func (s *Service) closeProgram(w http.ResponseWriter, r *http.Request) {
	p := r.PathValue("program")
	if !s.manager(r.Context(), p, bearer(r)) {
		fail(w, 403)
		return
	}
	_, e := s.DB.Exec(r.Context(), "UPDATE programs SET closed=true WHERE id=$1", p)
	if e != nil {
		fail(w, 503)
		return
	}
	write(w, 200, map[string]bool{"closed": true})
}
func (s *Service) traditional(w http.ResponseWriter, r *http.Request) {
	tx, spec, e := s.writer(r)
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) || errors.Is(e, errUnauthorized) {
			fail(w, 403)
		} else {
			fail(w, 503)
		}
		return
	}
	defer tx.Rollback(r.Context())
	if spec.Mode != "traditional" {
		fail(w, 409)
		return
	}
	if s.IngestURL == "" || s.IngestToken == "" {
		fail(w, 503)
		return
	}
	body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 128<<20))
	if e != nil {
		fail(w, 413)
		return
	}
	if validateTraditional(body, spec) != nil {
		fail(w, 400)
		return
	}
	// No caller-supplied destination/token/user headers reach the traditional ingest.
	u, e := url.Parse(s.IngestURL)
	if e != nil {
		fail(w, 503)
		return
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/v1/batches"
	req, e := http.NewRequestWithContext(r.Context(), "POST", u.String(), bytes.NewReader(body))
	if e != nil {
		fail(w, 400)
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.IngestToken)
	req.Header.Set("X-User-ID", r.PathValue("participant"))
	req.Header.Set("Content-Type", "application/x-ndjson")
	req.Header.Set("Content-Encoding", "gzip")
	req.Header.Set("X-Puls-Protocol", "1")
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, e := client.Do(req)
	if e != nil {
		fail(w, 503)
		return
	}
	defer resp.Body.Close()
	// Do not echo upstream bodies which may contain record values.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fail(w, 502)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, 503)
		return
	}
	write(w, 200, map[string]bool{"accepted": true})
}
