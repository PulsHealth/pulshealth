// Command mcp is the PulsHealth MCP server: read-only access to one person's
// Apple Health data for AI assistants, over the product API only.
//
// It runs in two modes. By default it speaks the Model Context Protocol on
// stdin/stdout for local clients (Claude Desktop, Claude Code, Cursor, ...).
// With --http it serves the streamable HTTP transport at /mcp for remote
// clients, behind a bearer token. See README.md and docs/ai.md.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"
	"time"
	// Embed the IANA zone database so PULS_TIME_ZONE resolves in the
	// distroless image, which has no /usr/share/zoneinfo.
	_ "time/tzdata"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	defaultAPIURL   = "http://127.0.0.1:8081"
	shutdownTimeout = 15 * time.Second
	healthzTimeout  = 2 * time.Second
	// Idle HTTP sessions (no request from the client) are dropped after this.
	sessionTimeout = 30 * time.Minute
)

// buildVersion is set by the Dockerfile via -ldflags "-X main.buildVersion=…".
// A `go install` build reports the module version from the build info; a
// plain `go build` reports "dev".
var buildVersion string

func version() string {
	if buildVersion != "" {
		return buildVersion
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return "dev"
}

// config is everything read from the environment.
type config struct {
	apiURL   string
	apiToken string
	mcpToken string
	loc      *time.Location
}

func loadConfig(getenv func(string) string) (config, error) {
	cfg := config{
		apiURL:   strings.TrimSpace(getenv("PULS_API_URL")),
		apiToken: getenv("PULS_API_TOKEN"),
		mcpToken: getenv("PULS_MCP_TOKEN"),
	}
	if cfg.apiURL == "" {
		cfg.apiURL = defaultAPIURL
	}
	if cfg.apiToken == "" {
		return cfg, errors.New("PULS_API_TOKEN must be set (the product API's bearer token, from server/.env)")
	}
	loc, err := loadTimeZone(getenv("PULS_TIME_ZONE"))
	if err != nil {
		return cfg, err
	}
	cfg.loc = loc
	return cfg, nil
}

// loadTimeZone resolves PULS_TIME_ZONE (an IANA name; empty means UTC). The
// product API does not report its zone, so this must be set to the same
// value the stack runs with — the tool descriptions say every date is in
// "the server's time zone", and this is what that resolves to.
func loadTimeZone(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("PULS_TIME_ZONE %q is not a valid IANA time zone: %w", name, err)
	}
	return loc, nil
}

func main() {
	httpAddr := flag.String("http", "", "serve the streamable HTTP transport on this address (e.g. 127.0.0.1:8082) instead of stdio; requires PULS_MCP_TOKEN")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version())
		return
	}

	// stdout belongs to the stdio transport: every log line goes to stderr.
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	if err := run(*httpAddr, logger); err != nil {
		logger.Error("fatal", "err", err.Error())
		os.Exit(1)
	}
}

func run(httpAddr string, logger *slog.Logger) error {
	cfg, err := loadConfig(os.Getenv)
	if err != nil {
		return err
	}
	if httpAddr != "" && cfg.mcpToken == "" {
		return errors.New("PULS_MCP_TOKEN must be set to serve --http: it is the only thing between the network and the health data")
	}
	api, err := NewAPIClient(cfg.apiURL, cfg.apiToken, nil)
	if err != nil {
		return err
	}
	svc := newService(api, cfg.loc)
	server := svc.newServer(version())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if httpAddr == "" {
		logger.Info("serving stdio", "api", api.BaseURL(), "time_zone", cfg.loc.String(), "version", version())
		return server.Run(ctx, &mcp.StdioTransport{})
	}

	httpSrv := &http.Server{
		Addr:              httpAddr,
		Handler:           svc.httpHandler(server, cfg.mcpToken, logger),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// No WriteTimeout: the streamable transport holds SSE streams open.
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", httpAddr, "api", api.BaseURL(), "time_zone", cfg.loc.String(), "version", version())
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	logger.Info("shutting down")
	shCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	return httpSrv.Shutdown(shCtx)
}

// httpHandler serves /mcp behind the bearer token and /healthz without it.
func (s *service) httpHandler(server *mcp.Server, token string, logger *slog.Logger) http.Handler {
	mcpHandler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		SessionTimeout: sessionTimeout,
		Logger:         logger,
		// The SDK's DNS-rebinding guard rejects requests that reach a
		// loopback listener with a non-loopback Host header — which is
		// exactly what a TLS reverse proxy on the same host (Tailscale
		// Serve, Caddy, nginx) forwards to 127.0.0.1:8082. The bearer token
		// is the access control here, and a rebinding page cannot present
		// it, so the guard buys nothing and breaks the supported setup.
		DisableLocalhostProtection: true,
	})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.Handle("/mcp", bearerAuth(token, mcpHandler))
	return mux
}

// bearerAuth admits only requests carrying the configured token.
func bearerAuth(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="pulshealth-mcp"`)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// handleHealthz reports whether this process is up and the product API (and
// through its own /healthz, its database) answers.
func (s *service) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), healthzTimeout)
	defer cancel()
	if err := s.api.Healthz(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "api": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "api": true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
