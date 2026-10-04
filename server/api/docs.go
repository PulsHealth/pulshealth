package main

import (
	_ "embed"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":        "PulsHealth Product API",
		"version":     "v1",
		"docs":        "/docs",
		"openapi":     "/openapi.json",
		"health":      "/healthz",
		"auth":        "Authorization: Bearer $PULS_API_TOKEN",
		"user":        "Optional ?user=<uuid> on every /v1 route selects the user (default PULS_USER_ID; others need PULS_MULTI_USER=true); GET /v1/users lists them.",
		"description": "Read-only API for downstream products that use PulsHealth data.",
	})
}

func (s *Server) handleDocs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(productAPIDocsHTML))
}

func (s *Server) handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/openapi+json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(openAPIDocument(requestOrigin(r, s.trustProxyHeaders))))
}

// openAPIOriginPlaceholder is the servers[0].url the stored document
// carries; every request fills it in with the base URL that request
// arrived on. Importers that build a client from the document — ChatGPT
// Actions above all — refuse a document whose servers entry is not a real
// URL, and a deployment cannot know its own public name.
const openAPIOriginPlaceholder = `"{{origin}}"`

// openAPIDocument is the served OpenAPI document for a deployment reachable
// at origin.
func openAPIDocument(origin string) string {
	return strings.Replace(productAPIOpenAPIJSON, openAPIOriginPlaceholder, strconv.Quote(origin), 1)
}

// requestOrigin reconstructs the base URL this request reached the API on,
// honouring the headers a TLS-terminating proxy sets (Tailscale Serve,
// Caddy, nginx), so the document a client downloads names the host that
// client used rather than the loopback address the service binds to. A host
// that is not a plausible authority falls back to "/", the relative server
// URL every OpenAPI 3.1 tool accepts.
//
// X-Forwarded-* is believed only when trustProxy says a proxy owns it — the
// same TRUST_PROXY_HEADERS switch, and the same default of off, that ingest
// applies to the rate-limit key. /openapi.json is unauthenticated, so without
// the gate any caller could choose the host the document advertises; and
// docs/ai.md tells people to fetch that document over a public URL and hand it
// to ChatGPT together with PULS_API_TOKEN, which makes a document naming the
// wrong host a way to deliver a credential somewhere it should not go.
func requestOrigin(r *http.Request, trustProxy bool) string {
	host := r.Host
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if trustProxy {
		if forwarded := firstForwardedValue(r.Header.Get("X-Forwarded-Host")); forwarded != "" {
			host = forwarded
		}
		switch firstForwardedValue(r.Header.Get("X-Forwarded-Proto")) {
		case "https":
			scheme = "https"
		case "http":
			scheme = "http"
		}
	}
	if !isHostAuthority(host) {
		return "/"
	}
	return scheme + "://" + host
}

// firstForwardedValue takes the first entry of a comma-separated
// X-Forwarded-* header, which is the one the client actually asked for.
func firstForwardedValue(header string) string {
	first, _, _ := strings.Cut(header, ",")
	return strings.TrimSpace(first)
}

// isHostAuthority accepts the characters a host[:port] authority may hold —
// letters, digits, dot, hyphen, colon, and the brackets of an IPv6 literal —
// and nothing else, so no header can inject into the document.
func isHostAuthority(host string) bool {
	if host == "" || len(host) > 255 {
		return false
	}
	alphanumeric := false
	for i := 0; i < len(host); i++ {
		c := host[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
			alphanumeric = true
		case c == '.' || c == '-' || c == ':' || c == '[' || c == ']':
		default:
			return false
		}
	}
	// Punctuation alone ("::::", "-") passes the character test but is not a
	// host; an importer would reject the resulting URL with a far more
	// confusing message than the relative "/" fallback gives.
	return alphanumeric
}

const productAPIDocsHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PulsHealth Product API</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; line-height: 1.5; background: Canvas; color: CanvasText; }
    main { max-width: 940px; margin: 0 auto; padding: 40px 20px 64px; }
    h1 { margin: 0 0 8px; font-size: 2rem; }
    h2 { margin: 32px 0 12px; font-size: 1.15rem; }
    p { max-width: 760px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding: 10px 8px; text-align: left; vertical-align: top; }
    th { font-size: 0.85rem; text-transform: uppercase; letter-spacing: .04em; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .94em; }
    pre { overflow-x: auto; padding: 14px; border-radius: 8px; background: color-mix(in srgb, CanvasText 8%, transparent); }
    .muted { color: color-mix(in srgb, CanvasText 68%, transparent); }
  </style>
</head>
<body>
<main>
  <h1>PulsHealth Product API</h1>
  <p class="muted">Read-only API for downstream products that use PulsHealth data.</p>
  <p>The full documentation &mdash; a guide and a reference for every endpoint with examples &mdash; is at <a href="https://pulshealth.com/docs/api/">pulshealth.com/docs/api</a>. This page is the summary this deployment serves for itself.</p>

  <h2>Access</h2>
  <p>Send <code>Authorization: Bearer $PULS_API_TOKEN</code> on every data request. Discovery endpoints <code>/</code>, <code>/docs</code>, <code>/openapi.json</code>, and <code>/healthz</code> are available without the token. A wrong or missing token is a <code>401</code>; after ten of them from one address in quick succession, that address gets <code>429</code> with <code>Retry-After</code> (ten more a minute, one every six seconds) until it slows down. A correct token is never throttled.</p>
  <pre><code>curl -H "Authorization: Bearer $PULS_API_TOKEN" "$PULS_API_BASE_URL/v1/catalog/types"</code></pre>
  <p>Every data request is answered for one user. By default that is the deployment&rsquo;s <code>PULS_USER_ID</code>; add <code>user=&lt;uuid&gt;</code> to any <code>/v1</code> query to ask about someone else. That is only allowed when the server runs with <code>PULS_MULTI_USER=true</code> &mdash; otherwise naming any other user is a <code>403</code>, never a quiet answer for the default user &mdash; and a value that is not a UUID is a <code>400</code>. Neither counts against the failed-authentication limit. <code>GET /v1/users</code> lists the users this deployment will answer for, with their upload counts.</p>

  <h2>Discovery</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Use</th></tr></thead>
    <tbody>
      <tr><td><code>GET</code></td><td><code>/</code></td><td>JSON index for the API.</td></tr>
      <tr><td><code>GET</code></td><td><code>/docs</code></td><td>This human-readable reference.</td></tr>
      <tr><td><code>GET</code></td><td><code>/openapi.json</code></td><td>Machine-readable OpenAPI 3.1 schema.</td></tr>
      <tr><td><code>GET</code></td><td><code>/healthz</code></td><td>Liveness and database ping.</td></tr>
    </tbody>
  </table>

  <h2>Data Endpoints</h2>
  <table>
    <thead><tr><th>Method</th><th>Path</th><th>Query</th><th>Returns</th></tr></thead>
    <tbody>
      <tr><td><code>GET</code></td><td><code>/v1/users</code></td><td></td><td>Who this deployment answers for: each user with name, e-mail, last sync and upload counts, plus the default user, whether <code>user=</code> may name others, and <code>timeZone</code>, the <code>PULS_TIME_ZONE</code> every local day is cut in.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/profile</code></td><td></td><td>The user&rsquo;s profile fields.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/catalog/types</code></td><td></td><td>Available HealthKit identifiers, kind, unit, raw/aggregate row counts, earliest/latest timestamps.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/metrics/latest</code></td><td><code>types=a,b</code></td><td>Latest quantity value per requested identifier.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/metrics/daily</code></td><td><code>types=a,b&amp;start=ms&amp;end=ms</code>, <code>limit?</code>, <code>offset?</code></td><td>Local-day metric series from <code>metric_daily</code>, paged in days.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/activity/summary</code></td><td><code>start=ms&amp;end=ms</code></td><td>Activity rings by day.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/workouts</code></td><td><code>start?</code>, <code>end?</code>, <code>activityType?</code>, <code>limit?</code>, <code>offset?</code></td><td>Workout summaries and pagination offset.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/workouts/{uuid}</code></td><td></td><td>Workout detail, available metrics, statistics, events, and activities.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/workouts/{uuid}/series</code></td><td><code>types?</code>, <code>maxPoints?</code></td><td>Intra-workout streams (heart rate, power, speed, &hellip;) as <code>[t, value]</code> pairs, downsampled.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/sleep/daily</code></td><td><code>start=ms&amp;end=ms</code></td><td>One row per night, attributed to the wake-up day, with stage minutes.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/samples</code></td><td><code>type</code>, <code>start=ms&amp;end=ms</code>, <code>limit?</code>, <code>offset?</code></td><td>Raw samples of one quantity or category type.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/state-of-mind</code></td><td><code>start=ms&amp;end=ms</code></td><td>State of Mind entries: valence, labels, associations.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/summary</code></td><td><code>range?</code> (<code>7d</code>, <code>14d</code>, <code>30d</code>, <code>90d</code>), <code>format?</code> (<code>markdown</code>, <code>json</code>)</td><td>The last N days as one short markdown page &mdash; activity, heart, sleep, workouts, body, coverage &mdash; for pasting into a chat.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/export</code></td><td><code>format</code>, <code>dataset</code>, <code>start=ms&amp;end=ms</code>, plus that dataset's filters</td><td>A whole range as a streamed CSV or JSONL download.</td></tr>
    </tbody>
  </table>

  <h2>Sleep</h2>
  <p><code>/v1/sleep/daily</code> returns one row per sleep session. A session is attributed to the local calendar day it <em>ends</em> on — the wake-up day, matching Apple Health — and samples more than three hours apart start a new session, so a nap gets its own row. All durations are minutes.</p>
  <p>An iPhone, an Apple Watch and a third-party app can all record the same night. The endpoint never sums them: <code>inBedMinutes</code> is the highest single-source in-bed total, and <code>asleepMinutes</code> plus the whole <code>stages</code> breakdown come together from the one source that recorded the most sleep (ties go to the source with more stage detail). <code>sources</code> counts how many contributed. <code>asleepMinutes</code> is core + deep + REM + unspecified; <code>stages.awake</code> is time awake during the session and is not part of it. This mirrors the web viewer's daily sleep series.</p>

  <h2>Daily metrics</h2>
  <p><code>/v1/metrics/daily</code> returns one value per local calendar day for each requested type, nested as <code>metrics[].days[]</code> in the order the types were asked for, each ascending by day. It pages in <strong>days across the requested types</strong>: <code>limit</code> (default 10000, caps at 50000) and <code>offset</code> count day rows, not metrics, and <code>nextOffset</code> is <code>offset</code> plus the rows on the page &mdash; a short page (fewer rows than <code>limit</code>) is the last. A page boundary can fall inside a metric&rsquo;s days, so the next page may open with a metric the previous one already carried; append its days. A request that names no <code>limit</code> gets the default page, which holds a year of 27 types or a decade of two; a wider request pages. Only types the phone aggregates daily appear (<code>/v1/catalog/types</code> shows <code>aggregateRows</code>), and the values are deduplicated across devices.</p>

  <h2>Raw samples</h2>
  <p><code>/v1/samples</code> serves individual HealthKit records for exactly one type, ordered by start time, at most 31 days per request (<code>limit</code> defaults to 1000, caps at 5000; page with <code>nextOffset</code>). Unlike <code>/v1/metrics/daily</code> these are <strong>not</strong> deduplicated: if an iPhone and an Apple Watch both recorded the same minutes, both rows come back. A quantity sample carries <code>value</code> in the page's canonical <code>unit</code>; a category sample carries the integer <code>value</code> and its HealthKit <code>label</code>.</p>

  <h2>Summary</h2>
  <p><code>/v1/summary</code> is the endpoint for a chat that has no MCP connection: one short markdown page (under sixty lines) covering the last <code>range</code> calendar days &mdash; <code>7d</code> (the default), <code>14d</code>, <code>30d</code> or <code>90d</code>, ending today in <code>PULS_TIME_ZONE</code> &mdash; that you fetch with <code>curl</code> and paste. It carries a header (whose data, which days, when it was generated and in which zone), then a section for each kind of data that exists: activity (steps, active energy, exercise minutes and stand hours, each as a daily mean and, where a sum means something, a total), heart (resting heart rate and HRV), sleep (time asleep per night over the longest session of each wake-up day), workouts (count, total time, distance, the most frequent activities), body (the newest weight and body-fat readings, whenever they were taken) and a coverage line (last sync, days with data, and the reminder that daily figures are already deduplicated across devices). Every figure comes from the same daily surfaces as the endpoints above &mdash; <code>metric_daily</code>, the Activity rings, <code>/v1/sleep/daily</code>, <code>/v1/workouts</code>, <code>/v1/metrics/latest</code> &mdash; so it is cheap, and nothing in it is a sum of raw samples. <code>format=json</code> returns the same numbers as a <code>Summary</code> object instead of prose.</p>
  <pre><code>curl -H "Authorization: Bearer $PULS_API_TOKEN" "$PULS_API_BASE_URL/v1/summary?range=7d"</code></pre>

  <h2>Export</h2>
  <p><code>/v1/export</code> returns a whole range as a file rather than a JSON document, for a spreadsheet, a notebook, or a chat attachment. Both parameters are required: <code>format</code> is <code>csv</code> or <code>jsonl</code>, <code>dataset</code> is one of <code>daily_metrics</code>, <code>samples</code>, <code>workouts</code>, <code>sleep</code>, <code>activity</code>, <code>state_of_mind</code>. <code>start</code> and <code>end</code> are required for every dataset; <code>daily_metrics</code> also takes <code>types</code>, <code>samples</code> takes <code>type</code>, and <code>workouts</code> takes an optional <code>activityType</code>.</p>
  <pre><code>curl -fL -H "Authorization: Bearer $PULS_API_TOKEN" -OJ \
  "$PULS_API_BASE_URL/v1/export?format=csv&amp;dataset=sleep&amp;start=1735689600000&amp;end=1738368000000"</code></pre>
  <p>The response is streamed (<code>Transfer-Encoding: chunked</code>) and arrives as an attachment called <code>puls-&lt;dataset&gt;-&lt;start&gt;-&lt;end&gt;.&lt;csv|jsonl&gt;</code>. CSV opens with a header row; JSONL writes one JSON object per line whose keys are exactly those column names. Field names are the JSON endpoints' names; where an endpoint nests, the export flattens — a metric's days become one row each carrying <code>identifier</code> and <code>unit</code>, a night's stage minutes become <code>stages.core</code>, <code>stages.deep</code> and so on, and a list (a workout's <code>availableMetrics</code>, an entry's <code>labels</code>) is comma-joined inside its CSV cell and stays an array in JSONL. Ranges are capped at 31 days for <code>samples</code>, as on <code>/v1/samples</code>, and 366 days for every other dataset — the cap <code>/v1/sleep/daily</code> and <code>/v1/state-of-mind</code> already apply, and deliberately stricter than <code>/v1/metrics/daily</code> and <code>/v1/workouts</code>, which are bounded by a page size instead, and <code>/v1/activity/summary</code>, which is one small row per day. <code>daily_metrics</code> and <code>workouts</code> return the whole range (workouts newest first); <code>limit</code> and <code>offset</code> do not apply to an export. At most two exports run at once — each holds a database connection for the length of the download — and a third gets a <code>503</code> with <code>Retry-After</code>. An export ends after 30 minutes, and one whose client stops reading for a minute is dropped. A failure after the first rows are on the wire aborts the connection, so a truncated file is always a visibly failed download rather than a short one.</p>

  <h2>Conventions</h2>
  <p>Every <code>/v1</code> endpoint takes the optional <code>user</code> parameter described under Access. All timestamps are epoch milliseconds (0 to 253402300799999; anything else is a <code>400</code>). Workout ranges are <code>[start, end)</code> on the workout start time. The daily endpoints (<code>/v1/metrics/daily</code>, <code>/v1/activity/summary</code>) return every local calendar day — in the server's configured zone, <code>PULS_TIME_ZONE</code> — that overlaps <code>[start, end)</code>, so a range that touches one minute of a day returns that whole day. Paged endpoints (<code>/v1/metrics/daily</code>, <code>/v1/workouts</code>, <code>/v1/samples</code>) take <code>limit</code> and <code>offset</code> and answer with <code>nextOffset</code>; a page shorter than <code>limit</code> is the last. <code>/v1/sleep/daily</code> and <code>/v1/state-of-mind</code> use those same local days and reject ranges over 366 days. A <code>types</code> list names at most 50 identifiers. A query that runs longer than 30 seconds is a <code>504</code>: narrow the range. Empty result sets return empty arrays.</p>
</main>
</body>
</html>
`

// productAPIOpenAPIJSON is the OpenAPI 3.1 document, kept as its own file so
// the site's API reference (pulshealth.com/docs/api-reference/) renders from
// the very bytes this binary serves. TestOpenAPIDescribesTheRouter keeps it
// in step with the router.
//
//go:embed openapi.json
var productAPIOpenAPIJSON string
