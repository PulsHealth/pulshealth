package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// The `healthcheck` subcommand.
//
// The images are distroless — no shell, no curl — so a Compose healthcheck
// cannot fetch /healthz with anything but this binary. `<binary> healthcheck
// [addr]` GETs http://<addr>/healthz on the loopback interface and exits 0
// on a 200, 1 on anything else (one line on stderr says why). addr is a
// listen address such as ":8080"; an empty or wildcard host means 127.0.0.1.
// Without it the caller's default is used (ingest and the API pass their
// LISTEN_ADDR).
//
// Identical in ingest, the product API and the MCP server; see
// scripts/check-go-copies.sh.
const healthcheckTimeout = 3 * time.Second

func runHealthcheck(args []string, defaultAddr string, stderr io.Writer) int {
	addr := defaultAddr
	switch len(args) {
	case 0:
	case 1:
		addr = args[0]
	default:
		fmt.Fprintln(stderr, "usage: healthcheck [listen address, e.g. :8080]")
		return 2
	}
	target, err := healthcheckURL(addr)
	if err != nil {
		fmt.Fprintln(stderr, "healthcheck:", err)
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), healthcheckTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		fmt.Fprintln(stderr, "healthcheck:", err)
		return 2
	}
	// Never through a proxy from the environment: this is the process
	// asking itself.
	client := &http.Client{Transport: &http.Transport{Proxy: nil}}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintln(stderr, "unhealthy:", err)
		return 1
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(stderr, "unhealthy: %s answered %d\n", target, resp.StatusCode)
		return 1
	}
	return 0
}

// healthcheckURL turns a listen address into the /healthz URL on loopback.
func healthcheckURL(addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		return "", fmt.Errorf("listen address %q is not host:port or :port", addr)
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/healthz", nil
}
