package main

import (
	"context"
	"net/http"
)

// Users: GET /v1/users lists who the database holds, so a client can find a
// user id to pass as ?user= — the discovery half of per-request scoping
// (see scopeUser in main.go). It is the one endpoint whose answer is not
// about a single user.

// User is one row of GET /v1/users: the users row plus what the batches log
// says about its uploads. The counts come from batches alone — one row per
// upload, cheap to aggregate — never from the sample hypertables.
type User struct {
	UserID    string  `json:"userID"`
	Name      *string `json:"name"`
	Email     *string `json:"email"`
	CreatedAt int64   `json:"createdAt"`
	// Epoch milliseconds of the most recent batch; null when nothing has
	// ever been uploaded for this user.
	LastSync *int64 `json:"lastSync"`
	// Batches received, and the samples they declared (the sum of their
	// sampleCount headers).
	Batches         int64 `json:"batches"`
	UploadedSamples int64 `json:"uploadedSamples"`
}

// UsersResponse is GET /v1/users.
type UsersResponse struct {
	Users []User `json:"users"`
	// The user served when a request names none (PULS_USER_ID).
	Default string `json:"default"`
	// Whether ?user= may name anyone else (PULS_MULTI_USER).
	MultiUser bool `json:"multiUser"`
}

// Users returns every users row, oldest first, with its upload counts.
func (st *Store) Users(ctx context.Context) ([]User, error) {
	rows, err := st.pool.Query(ctx, `
		SELECT u.id::text, u.name, u.email,
		       (extract(epoch FROM u.created_at) * 1000)::bigint,
		       (extract(epoch FROM b.last_sync) * 1000)::bigint,
		       COALESCE(b.batches, 0)::bigint,
		       COALESCE(b.samples, 0)::bigint
		FROM users u
		LEFT JOIN (
			SELECT user_id,
			       max(received_at) AS last_sync,
			       count(*) AS batches,
			       sum(sample_count) AS samples
			FROM batches
			GROUP BY user_id
		) b ON b.user_id = u.id
		ORDER BY u.created_at, u.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]User, 0)
	for rows.Next() {
		var u User
		if err := rows.Scan(
			&u.UserID,
			&u.Name,
			&u.Email,
			&u.CreatedAt,
			&u.LastSync,
			&u.Batches,
			&u.UploadedSamples,
		); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.Users(r.Context())
	if err != nil {
		s.log.Error("users query failed", "err", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "users failed"})
		return
	}
	def := s.defaultUser()
	if !s.multiUser {
		// With the gate off nobody else can be read, so nobody else is
		// listed: the endpoint describes what this deployment serves, not
		// what the database holds.
		kept := make([]User, 0, 1)
		for _, u := range users {
			if sameUser(u.UserID, def) {
				kept = append(kept, u)
			}
		}
		users = kept
	}
	writeJSON(w, http.StatusOK, UsersResponse{Users: users, Default: def, MultiUser: s.multiUser})
}
