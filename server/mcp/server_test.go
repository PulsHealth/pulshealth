package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var wantTools = []string{
	"get_activity_rings",
	"get_daily_metrics",
	"get_latest_metrics",
	"get_profile",
	"get_workout",
	"list_available_types",
	"list_workouts",
}

func toolNames(res *mcp.ListToolsResult) []string {
	names := make([]string, 0, len(res.Tools))
	for _, tool := range res.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	return names
}

func textOf(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	if len(res.Content) != 1 {
		t.Fatalf("content = %+v, want one block", res.Content)
	}
	tc, ok := res.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("content = %T", res.Content[0])
	}
	return tc.Text
}

// TestServer_EndToEndInMemory drives the real MCP server through the SDK's
// in-memory transport: list tools, call two of them, read both resources,
// get a prompt.
func TestServer_EndToEndInMemory(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/catalog/types", http.StatusOK, fixtureCatalog)
	f.respond("/v1/metrics/daily", http.StatusOK, fixtureDaily)
	s := f.service(t, "Europe/Berlin")
	server := s.newServer("test")

	ctx := context.Background()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer serverSession.Close()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	tools, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		t.Fatal(err)
	}
	if got := toolNames(tools); strings.Join(got, ",") != strings.Join(wantTools, ",") {
		t.Errorf("tools = %v, want %v", got, wantTools)
	}
	for _, tool := range tools.Tools {
		if tool.Description == "" || tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Errorf("tool %s lacks a description or the read-only annotation", tool.Name)
		}
		if tool.InputSchema == nil {
			t.Errorf("tool %s has no input schema", tool.Name)
		}
	}

	// A no-argument tool.
	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_available_types", Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("list_available_types errored: %s", textOf(t, res))
	}
	var catalog catalogOutput
	if err := json.Unmarshal([]byte(textOf(t, res)), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Types) != 2 || catalog.Types[0].Identifier != "HKQuantityTypeIdentifierStepCount" || catalog.Today != "2026-09-07" {
		t.Errorf("catalog = %+v", catalog)
	}

	// A tool with validated, typed arguments.
	res, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "get_daily_metrics", Arguments: map[string]any{
		"types":      []string{"HKQuantityTypeIdentifierStepCount"},
		"start_date": "2026-03-28",
		"end_date":   "2026-03-29",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("get_daily_metrics errored: %s", textOf(t, res))
	}
	var daily dailyOutput
	if err := json.Unmarshal([]byte(textOf(t, res)), &daily); err != nil {
		t.Fatal(err)
	}
	if len(daily.Metrics) != 1 || len(daily.Metrics[0].Days) != 2 || daily.TimeZone != "Europe/Berlin" {
		t.Errorf("daily = %+v", daily)
	}

	// A handler error is a tool error the model can read, not a protocol
	// failure.
	res, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "get_daily_metrics", Arguments: map[string]any{
		"types":      []string{"HKQuantityTypeIdentifierStepCount"},
		"start_date": "2026-03-29",
		"end_date":   "2026-03-28",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError || !strings.Contains(textOf(t, res), "before start_date") {
		t.Errorf("reversed range: IsError=%v text=%q", res.IsError, textOf(t, res))
	}

	// Resources.
	resources, err := session.ListResources(ctx, &mcp.ListResourcesParams{})
	if err != nil {
		t.Fatal(err)
	}
	if len(resources.Resources) != 2 {
		t.Errorf("resources = %+v", resources.Resources)
	}
	guide, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: guideURI})
	if err != nil {
		t.Fatal(err)
	}
	if len(guide.Contents) != 1 || guide.Contents[0].MIMEType != "text/markdown" || !strings.Contains(guide.Contents[0].Text, "double-counting") {
		t.Errorf("guide = %+v", guide.Contents)
	}
	types, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: typesURI})
	if err != nil {
		t.Fatal(err)
	}
	var live catalogOutput
	if err := json.Unmarshal([]byte(types.Contents[0].Text), &live); err != nil || len(live.Types) != 2 {
		t.Errorf("types resource = %+v (%v)", types.Contents, err)
	}

	// Prompts.
	prompts, err := session.ListPrompts(ctx, &mcp.ListPromptsParams{})
	if err != nil {
		t.Fatal(err)
	}
	if len(prompts.Prompts) != 2 {
		t.Errorf("prompts = %+v", prompts.Prompts)
	}
	prompt, err := session.GetPrompt(ctx, &mcp.GetPromptParams{Name: "weekly_summary", Arguments: map[string]string{"week_ending": "2026-09-07"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(prompt.Messages) != 1 {
		t.Fatalf("messages = %+v", prompt.Messages)
	}
	if text := prompt.Messages[0].Content.(*mcp.TextContent).Text; !strings.Contains(text, "2026-09-01 to 2026-09-07") {
		t.Errorf("weekly_summary text = %q", text)
	}
	compare, err := session.GetPrompt(ctx, &mcp.GetPromptParams{Name: "compare_workouts", Arguments: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if text := compare.Messages[0].Content.(*mcp.TextContent).Text; !strings.Contains(text, "2026-09 with those in 2026-08") {
		t.Errorf("compare_workouts text = %q", text)
	}
}

type bearerRoundTripper struct{ token string }

func (b bearerRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

// TestHTTP_TokenGatesMCPButNotHealthz covers --http mode: /healthz answers
// without a token, /mcp refuses without or with the wrong one, and a client
// presenting the token completes the MCP handshake over streamable HTTP.
func TestHTTP_TokenGatesMCPButNotHealthz(t *testing.T) {
	f := newFakeAPI(t)
	f.respond("/v1/catalog/types", http.StatusOK, fixtureCatalog)
	s := f.service(t, "UTC")
	server := s.newServer("test")
	ts := httptest.NewServer(s.httpHandler(server, "mcp-secret", slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `"api":true`) {
		t.Errorf("healthz = %d %s", resp.StatusCode, body)
	}

	for name, token := range map[string]string{"no token": "", "wrong token": "Bearer nope", "basic": "Basic abc"} {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("WWW-Authenticate") == "" {
			t.Errorf("%s: /mcp = %d, want 401 with WWW-Authenticate", name, resp.StatusCode)
		}
	}

	ctx := context.Background()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:   ts.URL + "/mcp",
		HTTPClient: &http.Client{Transport: bearerRoundTripper{token: "mcp-secret"}},
	}, nil)
	if err != nil {
		t.Fatalf("connect with the token: %v", err)
	}
	defer session.Close()
	tools, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		t.Fatal(err)
	}
	if got := toolNames(tools); strings.Join(got, ",") != strings.Join(wantTools, ",") {
		t.Errorf("tools over HTTP = %v", got)
	}
	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_available_types", Arguments: map[string]any{}})
	if err != nil || res.IsError {
		t.Fatalf("list_available_types over HTTP: err=%v res=%+v", err, res)
	}
}

func TestHTTP_HealthzReportsAPIDown(t *testing.T) {
	down := httptest.NewServer(http.NotFoundHandler())
	down.Close()
	api, err := NewAPIClient(down.URL, "t", nil)
	if err != nil {
		t.Fatal(err)
	}
	s := newService(api, nil)
	ts := httptest.NewServer(s.httpHandler(s.newServer("test"), "x", slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("healthz with the API down = %d, want 503", resp.StatusCode)
	}
}

func TestLoadConfig(t *testing.T) {
	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}
	if _, err := loadConfig(env(map[string]string{})); err == nil || !strings.Contains(err.Error(), "PULS_API_TOKEN") {
		t.Errorf("missing token: %v", err)
	}
	if _, err := loadConfig(env(map[string]string{"PULS_API_TOKEN": "t", "PULS_TIME_ZONE": "Mars/Olympus"})); err == nil || !strings.Contains(err.Error(), "PULS_TIME_ZONE") {
		t.Errorf("bad zone: %v", err)
	}
	cfg, err := loadConfig(env(map[string]string{"PULS_API_TOKEN": "t"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.apiURL != defaultAPIURL || cfg.loc.String() != "UTC" {
		t.Errorf("defaults = %+v", cfg)
	}
	cfg, err = loadConfig(env(map[string]string{"PULS_API_TOKEN": "t", "PULS_API_URL": " http://api:8081/ ", "PULS_TIME_ZONE": "Europe/Berlin", "PULS_MCP_TOKEN": "m"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.apiURL != "http://api:8081/" || cfg.loc.String() != "Europe/Berlin" || cfg.mcpToken != "m" {
		t.Errorf("config = %+v", cfg)
	}
}
