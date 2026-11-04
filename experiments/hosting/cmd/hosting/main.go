package main

import (
	"context"
	hosting "github.com/PulsHealth/pulshealth/experiments/hosting"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	if len(os.Getenv("PROVISION_TOKEN")) < 32 {
		log.Fatal("PROVISION_TOKEN must contain at least 32 characters")
	}
	db, e := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
	if e != nil {
		log.Fatal("database configuration failed")
	}
	defer db.Close()
	if db.Ping(context.Background()) != nil {
		log.Fatal("database unavailable")
	}
	s := &hosting.Service{DB: db, ProvisionToken: os.Getenv("PROVISION_TOKEN"), IngestURL: os.Getenv("INGEST_URL"), IngestToken: os.Getenv("INGEST_TOKEN")}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8099"
	}
	server := &http.Server{Addr: addr, Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 90 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Fatal(server.ListenAndServe())
}
