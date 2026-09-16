package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func twoUsers() []User {
	name := "Ada"
	email := "ada@example.com"
	last := int64(1789997400000)
	return []User{
		{UserID: defaultUserID, CreatedAt: 1751328000000, LastSync: &last, Batches: 12, UploadedSamples: 3400},
		{UserID: "7b1e4c2a-9d3f-4e5a-8b6c-0f1d2e3a4b5c", Name: &name, Email: &email, CreatedAt: 1751414400000},
	}
}

func TestUsersEndpointShape(t *testing.T) {
	t.Parallel()

	srv := scopedServer(t, &fakeStore{users: twoUsers()}, defaultUserID, true)
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/users", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}

	// The wire shape, key by key, as a client written from the OpenAPI
	// document would read it.
	var body struct {
		Users     []map[string]json.RawMessage `json:"users"`
		Default   string                       `json:"default"`
		MultiUser bool                         `json:"multiUser"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Default != defaultUserID || !body.MultiUser {
		t.Fatalf("default = %q multiUser = %v, want %q true", body.Default, body.MultiUser, defaultUserID)
	}
	if len(body.Users) != 2 {
		t.Fatalf("users = %d, want both with the gate on", len(body.Users))
	}
	for i, u := range body.Users {
		for _, key := range []string{"userID", "name", "email", "createdAt", "lastSync", "batches", "uploadedSamples"} {
			if _, ok := u[key]; !ok {
				t.Errorf("user %d lacks %q: %s", i, key, rec.Body.String())
			}
		}
	}
	if string(body.Users[0]["lastSync"]) != "1789997400000" || string(body.Users[0]["batches"]) != "12" {
		t.Errorf("first user = %s", rec.Body.String())
	}
	// A user who has never synced carries explicit nulls and zero counts,
	// never missing keys.
	if string(body.Users[1]["lastSync"]) != "null" || string(body.Users[1]["batches"]) != "0" || string(body.Users[1]["uploadedSamples"]) != "0" {
		t.Errorf("second user = %s", rec.Body.String())
	}
	if string(body.Users[1]["name"]) != `"Ada"` {
		t.Errorf("name = %s", body.Users[1]["name"])
	}
}

func TestUsersEndpointListsOnlyDefaultWhenDisabled(t *testing.T) {
	t.Parallel()

	srv := scopedServer(t, &fakeStore{users: twoUsers()}, defaultUserID, false)
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/users", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var body UsersResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.MultiUser {
		t.Fatalf("multiUser = true with the gate off")
	}
	if len(body.Users) != 1 || body.Users[0].UserID != defaultUserID {
		t.Fatalf("users = %+v, want only the default user", body.Users)
	}

	// A default user with no users row yet lists nobody — an empty array,
	// not null — rather than inventing a row.
	unknown := scopedServer(t, &fakeStore{users: twoUsers()}, configuredUserID, false)
	rec = serveAuthorized(t, unknown, http.MethodGet, "/v1/users", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	assertJSONKeyIsArray(t, rec.Body.Bytes(), "users")

	// The endpoint sits behind the same gate as everything else: naming
	// another user in its query is refused, not ignored.
	rec = serveAuthorized(t, srv, http.MethodGet, "/v1/users?user="+otherUserID, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestUsersEndpointRequiresTheTokenAndReports500(t *testing.T) {
	t.Parallel()

	srv := scopedServer(t, &fakeStore{err: errors.New("boom")}, defaultUserID, true)
	rec := serveAuthorized(t, srv, http.MethodGet, "/v1/users", nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	assertJSONError(t, rec.Body.Bytes(), "users failed")

	if code, _ := authAttempt(t, srv, "", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("without a token: %d, want 401", code)
	}
}

// Every scoped operation declares the user parameter, and /v1/users — which
// is about everyone — does not, so a generated client offers the selector
// exactly where the router honours it.
func TestOpenAPIDeclaresTheUserParameterOnEveryScopedRoute(t *testing.T) {
	t.Parallel()

	srv := testServer(t, &fakeStore{})
	doc, _ := fetchOpenAPI(t, srv)
	for _, rt := range srv.apiRoutes() {
		op := doc.Paths[rt.path]["get"]
		declared := false
		for _, param := range op.Parameters {
			if param.Name == "user" && param.In == "query" && !param.Required {
				declared = true
			}
		}
		want := rt.auth && rt.path != "/v1/users"
		if declared != want {
			t.Errorf("%s: user parameter declared = %v, want %v", rt.path, declared, want)
		}
	}
}
