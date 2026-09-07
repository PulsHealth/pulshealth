package main

import "net/http"

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":        "PulsHealth Product API",
		"version":     "v1",
		"docs":        "/docs",
		"openapi":     "/openapi.json",
		"health":      "/healthz",
		"auth":        "Authorization: Bearer $PULS_API_TOKEN",
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
	_, _ = w.Write([]byte(productAPIOpenAPIJSON))
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

  <h2>Access</h2>
  <p>Send <code>Authorization: Bearer $PULS_API_TOKEN</code> on every data request. Discovery endpoints <code>/</code>, <code>/docs</code>, <code>/openapi.json</code>, and <code>/healthz</code> are available without the token.</p>
  <pre><code>curl -H "Authorization: Bearer $PULS_API_TOKEN" "$PULS_API_BASE_URL/v1/catalog/types"</code></pre>

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
      <tr><td><code>GET</code></td><td><code>/v1/profile</code></td><td></td><td>Default user profile fields.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/catalog/types</code></td><td></td><td>Available HealthKit identifiers, kind, unit, raw/aggregate row counts, earliest/latest timestamps.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/metrics/latest</code></td><td><code>types=a,b</code></td><td>Latest quantity value per requested identifier.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/metrics/daily</code></td><td><code>types=a,b&amp;start=ms&amp;end=ms</code></td><td>Local-day metric series from <code>metric_daily</code>.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/activity/summary</code></td><td><code>start=ms&amp;end=ms</code></td><td>Activity rings by day.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/workouts</code></td><td><code>start?</code>, <code>end?</code>, <code>activityType?</code>, <code>limit?</code>, <code>offset?</code></td><td>Workout summaries and pagination offset.</td></tr>
      <tr><td><code>GET</code></td><td><code>/v1/workouts/{uuid}</code></td><td></td><td>Workout detail, available metrics, statistics, events, and activities.</td></tr>
    </tbody>
  </table>

  <h2>Conventions</h2>
  <p>All timestamps are epoch milliseconds (0 to 253402300799999; anything else is a <code>400</code>). Workout ranges are <code>[start, end)</code> on the workout start time. The daily endpoints (<code>/v1/metrics/daily</code>, <code>/v1/activity/summary</code>) return every local calendar day — in the server's configured zone, <code>PULS_TIME_ZONE</code> — that overlaps <code>[start, end)</code>, so a range that touches one minute of a day returns that whole day. Empty result sets return empty arrays.</p>
</main>
</body>
</html>
`

const productAPIOpenAPIJSON = `{
  "openapi": "3.1.0",
  "info": {
    "title": "PulsHealth Product API",
    "version": "1.0.0",
    "description": "Read-only API for downstream products that use PulsHealth data."
  },
  "security": [{ "bearerAuth": [] }],
  "components": {
    "securitySchemes": {
      "bearerAuth": { "type": "http", "scheme": "bearer" }
    },
    "schemas": {
      "Profile": {
        "type": "object",
        "properties": {
          "userID": { "type": "string", "format": "uuid" },
          "name": { "type": ["string", "null"] },
          "email": { "type": ["string", "null"] },
          "dateOfBirth": { "type": ["integer", "null"], "format": "int64" },
          "biologicalSex": { "type": ["string", "null"] }
        }
      },
      "CatalogType": {
        "type": "object",
        "properties": {
          "identifier": { "type": "string" },
          "kind": { "type": "string" },
          "unit": { "type": ["string", "null"] },
          "rows": { "type": "integer", "format": "int64" },
          "rawRows": { "type": "integer", "format": "int64" },
          "aggregateRows": { "type": "integer", "format": "int64" },
          "earliest": { "type": ["integer", "null"], "format": "int64" },
          "latest": { "type": ["integer", "null"], "format": "int64" }
        }
      },
      "LatestMetric": {
        "type": "object",
        "properties": {
          "identifier": { "type": "string" },
          "unit": { "type": ["string", "null"] },
          "value": { "type": ["number", "null"] },
          "timestamp": { "type": "integer", "format": "int64" }
        }
      },
      "DailyMetric": {
        "type": "object",
        "properties": {
          "identifier": { "type": "string" },
          "unit": { "type": ["string", "null"] },
          "days": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "date": { "type": "string", "format": "date" },
                "value": { "type": ["number", "null"] }
              }
            }
          }
        }
      },
      "ActivityDay": {
        "type": "object",
        "properties": {
          "date": { "type": "string", "format": "date" },
          "moveKcal": { "type": ["number", "null"] },
          "moveGoalKcal": { "type": ["number", "null"] },
          "exerciseMin": { "type": ["number", "null"] },
          "exerciseGoalMin": { "type": ["number", "null"] },
          "standHours": { "type": ["number", "null"] },
          "standGoalHours": { "type": ["number", "null"] },
          "moveMode": { "type": ["integer", "null"] },
          "moveTimeMin": { "type": ["number", "null"] },
          "moveTimeGoalMin": { "type": ["number", "null"] }
        }
      },
      "WorkoutSummary": {
        "type": "object",
        "properties": {
          "uuid": { "type": "string", "format": "uuid" },
          "activityType": { "type": "string" },
          "start": { "type": "integer", "format": "int64" },
          "end": { "type": "integer", "format": "int64" },
          "durationS": { "type": ["number", "null"] },
          "distanceM": { "type": ["number", "null"] },
          "energyKcal": { "type": ["number", "null"] },
          "hasRoute": { "type": "boolean" },
          "availableMetrics": { "type": "array", "items": { "type": "string" } }
        }
      },
      "WorkoutDetail": {
        "allOf": [
          { "$ref": "#/components/schemas/WorkoutSummary" },
          {
            "type": "object",
            "properties": {
              "statisticsDetail": {
                "type": "object",
                "additionalProperties": {
                  "type": "object",
                  "properties": {
                    "min": { "type": "number" },
                    "avg": { "type": "number" },
                    "max": { "type": "number" },
                    "sum": { "type": "number" }
                  }
                }
              },
              "events": { "type": "array", "items": { "type": "object", "additionalProperties": true } },
              "activities": { "type": "array", "items": { "type": "object", "additionalProperties": true } }
            }
          }
        ]
      }
    }
  },
  "paths": {
    "/": {
      "get": {
        "security": [],
        "summary": "API index",
        "responses": { "200": { "description": "API index" } }
      }
    },
    "/docs": {
      "get": {
        "security": [],
        "summary": "Human-readable API docs",
        "responses": { "200": { "description": "HTML documentation" } }
      }
    },
    "/openapi.json": {
      "get": {
        "security": [],
        "summary": "OpenAPI schema",
        "responses": { "200": { "description": "OpenAPI document" } }
      }
    },
    "/healthz": {
      "get": {
        "security": [],
        "summary": "Health check",
        "responses": { "200": { "description": "Healthy" }, "503": { "description": "Database unavailable" } }
      }
    },
    "/v1/profile": {
      "get": {
        "summary": "Default user profile",
        "responses": { "200": { "description": "Profile", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Profile" } } } }, "401": { "description": "Unauthorized" }, "404": { "description": "Profile not found" } }
      }
    },
    "/v1/catalog/types": {
      "get": {
        "summary": "Available data types",
        "responses": { "200": { "description": "Catalog", "content": { "application/json": { "schema": { "type": "object", "properties": { "types": { "type": "array", "items": { "$ref": "#/components/schemas/CatalogType" } } } } } } } }
      }
    },
    "/v1/metrics/latest": {
      "get": {
        "summary": "Latest quantity metrics",
        "parameters": [{ "name": "types", "in": "query", "required": true, "schema": { "type": "string" }, "description": "Comma-separated HealthKit identifiers." }],
        "responses": { "200": { "description": "Latest metrics", "content": { "application/json": { "schema": { "type": "object", "properties": { "metrics": { "type": "array", "items": { "$ref": "#/components/schemas/LatestMetric" } } } } } } } }
      }
    },
    "/v1/metrics/daily": {
      "get": {
        "summary": "Daily metric series",
        "parameters": [
          { "name": "types", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "start", "in": "query", "required": true, "schema": { "type": "integer", "format": "int64" } },
          { "name": "end", "in": "query", "required": true, "schema": { "type": "integer", "format": "int64" } }
        ],
        "responses": { "200": { "description": "Daily metrics", "content": { "application/json": { "schema": { "type": "object", "properties": { "metrics": { "type": "array", "items": { "$ref": "#/components/schemas/DailyMetric" } } } } } } } }
      }
    },
    "/v1/activity/summary": {
      "get": {
        "summary": "Activity ring summaries",
        "parameters": [
          { "name": "start", "in": "query", "required": true, "schema": { "type": "integer", "format": "int64" } },
          { "name": "end", "in": "query", "required": true, "schema": { "type": "integer", "format": "int64" } }
        ],
        "responses": { "200": { "description": "Activity days", "content": { "application/json": { "schema": { "type": "object", "properties": { "days": { "type": "array", "items": { "$ref": "#/components/schemas/ActivityDay" } } } } } } } }
      }
    },
    "/v1/workouts": {
      "get": {
        "summary": "Workout summaries",
        "parameters": [
          { "name": "start", "in": "query", "required": false, "schema": { "type": "integer", "format": "int64" } },
          { "name": "end", "in": "query", "required": false, "schema": { "type": "integer", "format": "int64" } },
          { "name": "activityType", "in": "query", "required": false, "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "required": false, "schema": { "type": "integer", "default": 50, "maximum": 200 } },
          { "name": "offset", "in": "query", "required": false, "schema": { "type": "integer", "default": 0 } }
        ],
        "responses": { "200": { "description": "Workouts", "content": { "application/json": { "schema": { "type": "object", "properties": { "workouts": { "type": "array", "items": { "$ref": "#/components/schemas/WorkoutSummary" } }, "nextOffset": { "type": "integer" } } } } } } }
      }
    },
    "/v1/workouts/{uuid}": {
      "get": {
        "summary": "Workout detail",
        "parameters": [{ "name": "uuid", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
        "responses": { "200": { "description": "Workout detail", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/WorkoutDetail" } } } }, "400": { "description": "Invalid UUID" }, "404": { "description": "Workout not found" } }
      }
    }
  }
}
`
