package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	maxTypesPerCall     = 10
	maxDaysPerCall      = 366
	defaultWorkoutLimit = 50
	maxWorkoutLimit     = 200 // the product API's own cap
	maxWorkoutEvents    = 200
)

// service holds what every tool needs: the product API and the calendar
// zone every day boundary is computed in. now is swapped in tests.
type service struct {
	api *APIClient
	loc *time.Location
	now func() time.Time
}

func newService(api *APIClient, loc *time.Location) *service {
	if loc == nil {
		loc = time.UTC
	}
	return &service{api: api, loc: loc, now: time.Now}
}

func (s *service) localNow() time.Time { return s.now().In(s.loc) }

// serverInstructions reach the model with the initialize handshake, before
// it has read any tool description.
const serverInstructions = `Read-only access to one person's Apple Health data, synced by the PulsHealth app to a server they run. ` +
	`Start with list_available_types: it lists which HealthKit types have data, how current they are, today's date and the server's time zone. ` +
	`Read the pulshealth://guide resource for units, the iPhone-plus-Watch double-counting rule and which tool answers which question. ` +
	`Dates are YYYY-MM-DD in the server's time zone; daily values are already deduplicated across devices, so never sum raw samples yourself. ` +
	`Say which days have no data instead of treating them as zero.`

// newServer builds the MCP server with every tool, resource and prompt.
func (s *service) newServer(version string) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:       "pulshealth",
		Title:      "PulsHealth",
		Version:    version,
		WebsiteURL: "https://github.com/PulsHealth/pulshealth",
	}, &mcp.ServerOptions{Instructions: serverInstructions})
	s.addTools(server)
	s.addResources(server)
	s.addPrompts(server)
	return server
}

// readOnlyTool builds a Tool whose annotations say what every tool here is:
// read-only, idempotent, closed-world (one person's data).
func readOnlyTool(name, title, description string) *mcp.Tool {
	no := false
	return &mcp.Tool{
		Name:        name,
		Title:       title,
		Description: description,
		Annotations: &mcp.ToolAnnotations{
			Title:           title,
			ReadOnlyHint:    true,
			IdempotentHint:  true,
			DestructiveHint: &no,
			OpenWorldHint:   &no,
		},
	}
}

func (s *service) addTools(server *mcp.Server) {
	mcp.AddTool(server, readOnlyTool("get_profile", "Profile", descGetProfile), s.getProfile)
	mcp.AddTool(server, readOnlyTool("list_available_types", "Available data types", descListAvailableTypes), s.listAvailableTypes)
	mcp.AddTool(server, readOnlyTool("get_latest_metrics", "Latest readings", descGetLatestMetrics), s.getLatestMetrics)
	mcp.AddTool(server, readOnlyTool("get_daily_metrics", "Daily metrics", descGetDailyMetrics), s.getDailyMetrics)
	mcp.AddTool(server, readOnlyTool("get_activity_rings", "Activity rings", descGetActivityRings), s.getActivityRings)
	mcp.AddTool(server, readOnlyTool("list_workouts", "Workouts", descListWorkouts), s.listWorkouts)
	mcp.AddTool(server, readOnlyTool("get_workout", "Workout detail", descGetWorkout), s.getWorkout)
}

// Tool descriptions are written for the model: they name units, say how
// timestamps and dates are expressed, and warn about the traps (cumulative
// vs discrete, double counting, "%" as a fraction).

const descGetProfile = `Who this data belongs to: name, email, date of birth (YYYY-MM-DD) and biological sex as recorded in Apple Health, ` +
	`plus age_years computed from the date of birth. Also returns time_zone (the server's IANA zone, which every date in this server uses), ` +
	`today (the current date in that zone) and now. Returns an error if no profile has been synced yet.`

const descListAvailableTypes = `Lists every HealthKit data type this person has data for, with its unit, row counts and the earliest and latest ` +
	`timestamps — the natural first call: it tells you which identifiers exist, how far back the history goes and how current it is, ` +
	`and it returns time_zone and today so you know what date it is. Identifiers are HealthKit names such as ` +
	`HKQuantityTypeIdentifierStepCount, HKQuantityTypeIdentifierHeartRate, HKQuantityTypeIdentifierBodyMass, ` +
	`HKCategoryTypeIdentifierSleepAnalysis, HKWorkoutTypeIdentifier or HKActivitySummaryTypeIdentifier; kind is quantity, category, ` +
	`workout, activitySummary or another object kind. Units are HealthKit unit strings in which every value of that type is expressed ` +
	`(count, count/min for beats or breaths per minute, m, m/s, kcal, min, kg, ms, degC, mmHg, mg/dL, ml/kg*min); a unit of "%" means ` +
	`a FRACTION, so blood oxygen is 0.97, not 97. rows = raw_rows (individual samples) + aggregate_rows (on-device daily or hourly ` +
	`buckets); a type with only aggregate rows has daily values but no latest reading. Timestamps are ISO 8601 in the server's zone.`

const descGetLatestMetrics = `The most recent raw sample of each requested quantity type, e.g. HKQuantityTypeIdentifierBodyMass, ` +
	`HKQuantityTypeIdentifierRestingHeartRate, HKQuantityTypeIdentifierHeartRateVariabilitySDNN, HKQuantityTypeIdentifierOxygenSaturation, ` +
	`HKQuantityTypeIdentifierVO2Max: the value in the type's canonical unit, the unit, and the sample's timestamp (ISO 8601, server zone). ` +
	`Only quantity types with raw samples have a latest reading; anything else requested is listed under missing. ` +
	`For a cumulative type such as steps or active energy the latest sample is one small increment, NOT today's total — use ` +
	`get_daily_metrics for totals. as_of is the current server time, for judging how stale a reading is. 1 to 10 types per call.`

const descGetDailyMetrics = `One value per local calendar day for each requested type over an inclusive date range (start_date and ` +
	`end_date as YYYY-MM-DD in the server's time zone; equal for a single day; at most 366 days and 10 types per call). ` +
	`This is the deduplicated daily truth: cumulative types (steps, active energy, distance, exercise minutes, flights climbed, ...) ` +
	`are daily SUMS and discrete types (heart rate, resting heart rate, HRV, weight, oxygen saturation, ...) are daily AVERAGES. ` +
	`Each value comes from the on-device HealthKit daily aggregate when the phone synced one — HealthKit already removes the overlap ` +
	`between iPhone and Apple Watch — and otherwise from a single-source rollup, so it never double counts the way a naive sum of raw ` +
	`samples does. Values are in the type's canonical unit ("%" is a fraction). Days without data are omitted, not zero. ` +
	`Only quantity types the phone aggregates daily appear here (list_available_types shows aggregate_rows > 0); category types such ` +
	`as sleep are not available through this tool yet. Weekly or monthly figures: fetch the days and add or average them yourself.`

const descGetActivityRings = `Apple Watch Activity rings for each local calendar day in an inclusive date range (start_date and ` +
	`end_date as YYYY-MM-DD in the server's time zone; equal for a single day; at most 366 days per call): move_kcal against ` +
	`move_goal_kcal (active energy), exercise_min against exercise_goal_min, stand_hours against stand_goal_hours, and for people on ` +
	`the Move Time mode (move_mode 2 rather than 1) move_time_min against move_time_goal_min. A ring is closed when the value reaches ` +
	`its goal. Today's row is partial and keeps changing; days without a summary are omitted. These are the summaries the phone ` +
	`computed, not a reconstruction from samples.`

const descListWorkouts = `Workouts, newest first, optionally limited to those starting within an inclusive date range (start_date, ` +
	`end_date as YYYY-MM-DD in the server's time zone; either may be omitted) and to one activity_type. activity_type is an exact ` +
	`snake_case name as synced by the app: running, walking, cycling, hiking, swimming, strength_training, functional_strength_training, ` +
	`hiit, yoga, pilates, rowing, elliptical, stair_climbing, core_training, and others in the same style — call once without the ` +
	`filter to learn which names this person uses. Each workout has uuid, activity_type, start and end (ISO 8601), duration_s (seconds, ` +
	`active time excluding pauses), distance_m (metres), energy_kcal, has_route (GPS recorded) and available_metrics (the HealthKit ` +
	`types recorded during it, e.g. heart rate, running power). limit defaults to 50 and is capped at 200; when next_offset is ` +
	`present there are more, pass it as offset to page. Use get_workout with a uuid for statistics, events and multi-sport parts.`

const descGetWorkout = `Detail for one workout by uuid (from list_workouts): the summary fields plus statistics per HealthKit type ` +
	`recorded during it — min, avg and max in the canonical unit for discrete types such as HKQuantityTypeIdentifierHeartRate ` +
	`(count/min) or HKQuantityTypeIdentifierRunningPower (W), sum for cumulative ones such as HKQuantityTypeIdentifierActiveEnergyBurned ` +
	`(kcal) or HKQuantityTypeIdentifierDistanceWalkingRunning (m) — then events (pauses, resumes, laps, segments, markers; at most 200 ` +
	`returned, events_truncated says if more exist) and activities (the parts of a multi-sport workout, each with its own statistics). ` +
	`Timestamps are ISO 8601 in the server's zone. Second-by-second streams and the GPS route are not exposed through this server.`

// Inputs. jsonschema tags become the property descriptions the model reads;
// fields without omitempty are required.

type typesInput struct {
	Types []string `json:"types" jsonschema:"HealthKit type identifiers, e.g. HKQuantityTypeIdentifierStepCount; 1 to 10 per call. list_available_types shows which exist"`
}

type dailyInput struct {
	Types     []string `json:"types" jsonschema:"HealthKit type identifiers, e.g. HKQuantityTypeIdentifierStepCount; 1 to 10 per call. list_available_types shows which have daily values (aggregate_rows > 0)"`
	StartDate string   `json:"start_date" jsonschema:"First day of the range, inclusive, as YYYY-MM-DD in the server's time zone"`
	EndDate   string   `json:"end_date" jsonschema:"Last day of the range, inclusive, as YYYY-MM-DD; equal to start_date for a single day. At most 366 days per call"`
}

type rangeInput struct {
	StartDate string `json:"start_date" jsonschema:"First day of the range, inclusive, as YYYY-MM-DD in the server's time zone"`
	EndDate   string `json:"end_date" jsonschema:"Last day of the range, inclusive, as YYYY-MM-DD; equal to start_date for a single day. At most 366 days per call"`
}

type workoutsInput struct {
	StartDate    string `json:"start_date,omitempty" jsonschema:"Only workouts that started on or after this day (YYYY-MM-DD, server time zone). Optional"`
	EndDate      string `json:"end_date,omitempty" jsonschema:"Only workouts that started on or before this day (YYYY-MM-DD, server time zone). Optional"`
	ActivityType string `json:"activity_type,omitempty" jsonschema:"Exact snake_case activity name such as running, cycling, walking, hiking, swimming, strength_training, yoga. Optional; omit to list every activity"`
	Limit        int    `json:"limit,omitempty" jsonschema:"Maximum number of workouts to return, 1 to 200; default 50"`
	Offset       int    `json:"offset,omitempty" jsonschema:"Number of newest workouts to skip, for paging: pass the previous call's next_offset"`
}

type workoutInput struct {
	UUID string `json:"uuid" jsonschema:"The workout's uuid exactly as returned by list_workouts"`
}

// Outputs. Every tool returns one compact JSON object as text; field names
// carry the unit where one applies.

type profileOutput struct {
	UserID        string  `json:"user_id"`
	Name          *string `json:"name,omitempty"`
	Email         *string `json:"email,omitempty"`
	DateOfBirth   *string `json:"date_of_birth,omitempty"`
	AgeYears      *int    `json:"age_years,omitempty"`
	BiologicalSex *string `json:"biological_sex,omitempty"`
	TimeZone      string  `json:"time_zone"`
	Today         string  `json:"today"`
	Now           string  `json:"now"`
}

type catalogOutput struct {
	TimeZone string         `json:"time_zone"`
	Today    string         `json:"today"`
	Types    []catalogEntry `json:"types"`
}

type catalogEntry struct {
	Identifier    string  `json:"identifier"`
	Kind          string  `json:"kind"`
	Unit          *string `json:"unit,omitempty"`
	Rows          int64   `json:"rows"`
	RawRows       int64   `json:"raw_rows"`
	AggregateRows int64   `json:"aggregate_rows"`
	Earliest      *string `json:"earliest,omitempty"`
	Latest        *string `json:"latest,omitempty"`
}

type latestOutput struct {
	AsOf    string        `json:"as_of"`
	Metrics []latestEntry `json:"metrics"`
	Missing []string      `json:"missing,omitempty"`
}

type latestEntry struct {
	Identifier string   `json:"identifier"`
	Unit       *string  `json:"unit,omitempty"`
	Value      *float64 `json:"value"`
	Timestamp  string   `json:"timestamp"`
}

type dailyOutput struct {
	TimeZone  string       `json:"time_zone"`
	StartDate string       `json:"start_date"`
	EndDate   string       `json:"end_date"`
	Metrics   []dailyEntry `json:"metrics"`
	Missing   []string     `json:"missing,omitempty"`
}

type dailyEntry struct {
	Identifier string       `json:"identifier"`
	Unit       *string      `json:"unit,omitempty"`
	Days       []dailyPoint `json:"days"`
}

type dailyPoint struct {
	Date  string   `json:"date"`
	Value *float64 `json:"value"`
}

type ringsOutput struct {
	TimeZone  string    `json:"time_zone"`
	StartDate string    `json:"start_date"`
	EndDate   string    `json:"end_date"`
	Days      []ringDay `json:"days"`
}

type ringDay struct {
	Date            string   `json:"date"`
	MoveKcal        *float64 `json:"move_kcal,omitempty"`
	MoveGoalKcal    *float64 `json:"move_goal_kcal,omitempty"`
	ExerciseMin     *float64 `json:"exercise_min,omitempty"`
	ExerciseGoalMin *float64 `json:"exercise_goal_min,omitempty"`
	StandHours      *float64 `json:"stand_hours,omitempty"`
	StandGoalHours  *float64 `json:"stand_goal_hours,omitempty"`
	MoveMode        *int     `json:"move_mode,omitempty"`
	MoveTimeMin     *float64 `json:"move_time_min,omitempty"`
	MoveTimeGoalMin *float64 `json:"move_time_goal_min,omitempty"`
}

type workoutsOutput struct {
	TimeZone   string         `json:"time_zone"`
	Workouts   []workoutEntry `json:"workouts"`
	NextOffset *int           `json:"next_offset,omitempty"`
}

type workoutEntry struct {
	UUID             string   `json:"uuid"`
	ActivityType     string   `json:"activity_type"`
	Start            string   `json:"start"`
	End              string   `json:"end"`
	DurationS        *float64 `json:"duration_s,omitempty"`
	DistanceM        *float64 `json:"distance_m,omitempty"`
	EnergyKcal       *float64 `json:"energy_kcal,omitempty"`
	HasRoute         bool     `json:"has_route"`
	AvailableMetrics []string `json:"available_metrics"`
}

type workoutOutput struct {
	workoutEntry
	Statistics      map[string]WorkoutStatDetail `json:"statistics,omitempty"`
	Events          []map[string]any             `json:"events,omitempty"`
	EventsTruncated bool                         `json:"events_truncated,omitempty"`
	Activities      []map[string]any             `json:"activities,omitempty"`
}

// jsonResult renders v as one compact JSON text block. Handlers use Out=any
// and build the result themselves so the wire shape stays exactly this.
func jsonResult(v any) (*mcp.CallToolResult, any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}, nil, nil
}

func (s *service) getProfile(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
	p, err := s.api.Profile(ctx)
	if err != nil {
		return nil, nil, err
	}
	now := s.localNow()
	out := profileOutput{
		UserID:        p.UserID,
		Name:          p.Name,
		Email:         p.Email,
		BiologicalSex: p.BiologicalSex,
		TimeZone:      s.loc.String(),
		Today:         now.Format(dateLayout),
		Now:           now.Format(time.RFC3339),
	}
	if p.DateOfBirth != nil {
		// The API renders the birth date as midnight UTC.
		dob := time.UnixMilli(*p.DateOfBirth).UTC()
		date := dob.Format(dateLayout)
		age := ageYears(dob, now)
		out.DateOfBirth = &date
		out.AgeYears = &age
	}
	return jsonResult(out)
}

// catalog is shared by list_available_types and the pulshealth://types
// resource.
func (s *service) catalog(ctx context.Context) (catalogOutput, error) {
	types, err := s.api.CatalogTypes(ctx)
	if err != nil {
		return catalogOutput{}, err
	}
	out := catalogOutput{
		TimeZone: s.loc.String(),
		Today:    s.localNow().Format(dateLayout),
		Types:    make([]catalogEntry, 0, len(types)),
	}
	for _, t := range types {
		out.Types = append(out.Types, catalogEntry{
			Identifier:    t.Identifier,
			Kind:          t.Kind,
			Unit:          t.Unit,
			Rows:          t.Rows,
			RawRows:       t.RawRows,
			AggregateRows: t.AggregateRows,
			Earliest:      formatInstantPtr(t.Earliest, s.loc),
			Latest:        formatInstantPtr(t.Latest, s.loc),
		})
	}
	return out, nil
}

func (s *service) listAvailableTypes(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
	out, err := s.catalog(ctx)
	if err != nil {
		return nil, nil, err
	}
	return jsonResult(out)
}

// normalizeTypes trims, drops empties and duplicates, and bounds the count.
func normalizeTypes(types []string) ([]string, error) {
	out := make([]string, 0, len(types))
	seen := make(map[string]struct{}, len(types))
	for _, t := range types {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	if len(out) == 0 {
		return nil, errors.New("types must name at least one HealthKit identifier, e.g. HKQuantityTypeIdentifierStepCount")
	}
	if len(out) > maxTypesPerCall {
		return nil, fmt.Errorf("types names %d identifiers; at most %d per call — split them across calls", len(out), maxTypesPerCall)
	}
	return out, nil
}

// missingTypes lists the requested identifiers the API had nothing for.
func missingTypes(requested []string, returned map[string]struct{}) []string {
	var missing []string
	for _, t := range requested {
		if _, ok := returned[t]; !ok {
			missing = append(missing, t)
		}
	}
	return missing
}

func (s *service) getLatestMetrics(ctx context.Context, _ *mcp.CallToolRequest, in typesInput) (*mcp.CallToolResult, any, error) {
	types, err := normalizeTypes(in.Types)
	if err != nil {
		return nil, nil, err
	}
	metrics, err := s.api.LatestMetrics(ctx, types)
	if err != nil {
		return nil, nil, err
	}
	out := latestOutput{AsOf: s.localNow().Format(time.RFC3339), Metrics: make([]latestEntry, 0, len(metrics))}
	returned := make(map[string]struct{}, len(metrics))
	for _, m := range metrics {
		returned[m.Identifier] = struct{}{}
		out.Metrics = append(out.Metrics, latestEntry{
			Identifier: m.Identifier,
			Unit:       m.Unit,
			Value:      round4Ptr(m.Value),
			Timestamp:  formatInstant(m.Timestamp, s.loc),
		})
	}
	out.Missing = missingTypes(types, returned)
	return jsonResult(out)
}

func (s *service) getDailyMetrics(ctx context.Context, _ *mcp.CallToolRequest, in dailyInput) (*mcp.CallToolResult, any, error) {
	types, err := normalizeTypes(in.Types)
	if err != nil {
		return nil, nil, err
	}
	win, err := newDayWindow(in.StartDate, in.EndDate, s.loc, maxDaysPerCall)
	if err != nil {
		return nil, nil, err
	}
	metrics, err := s.api.DailyMetrics(ctx, types, win.StartMS, win.EndMS)
	if err != nil {
		return nil, nil, err
	}
	out := dailyOutput{
		TimeZone:  s.loc.String(),
		StartDate: win.StartDate,
		EndDate:   win.EndDate,
		Metrics:   make([]dailyEntry, 0, len(metrics)),
	}
	returned := make(map[string]struct{}, len(metrics))
	for _, m := range metrics {
		returned[m.Identifier] = struct{}{}
		entry := dailyEntry{Identifier: m.Identifier, Unit: m.Unit, Days: make([]dailyPoint, 0, len(m.Days))}
		for _, d := range m.Days {
			entry.Days = append(entry.Days, dailyPoint{Date: d.Date, Value: round4Ptr(d.Value)})
		}
		out.Metrics = append(out.Metrics, entry)
	}
	out.Missing = missingTypes(types, returned)
	return jsonResult(out)
}

func (s *service) getActivityRings(ctx context.Context, _ *mcp.CallToolRequest, in rangeInput) (*mcp.CallToolResult, any, error) {
	win, err := newDayWindow(in.StartDate, in.EndDate, s.loc, maxDaysPerCall)
	if err != nil {
		return nil, nil, err
	}
	days, err := s.api.ActivitySummary(ctx, win.StartMS, win.EndMS)
	if err != nil {
		return nil, nil, err
	}
	out := ringsOutput{
		TimeZone:  s.loc.String(),
		StartDate: win.StartDate,
		EndDate:   win.EndDate,
		Days:      make([]ringDay, 0, len(days)),
	}
	for _, d := range days {
		out.Days = append(out.Days, ringDay{
			Date:            d.Date,
			MoveKcal:        round4Ptr(d.MoveKcal),
			MoveGoalKcal:    round4Ptr(d.MoveGoalKcal),
			ExerciseMin:     round4Ptr(d.ExerciseMin),
			ExerciseGoalMin: round4Ptr(d.ExerciseGoalMin),
			StandHours:      round4Ptr(d.StandHours),
			StandGoalHours:  round4Ptr(d.StandGoalHours),
			MoveMode:        d.MoveMode,
			MoveTimeMin:     round4Ptr(d.MoveTimeMin),
			MoveTimeGoalMin: round4Ptr(d.MoveTimeGoalMin),
		})
	}
	return jsonResult(out)
}

func (s *service) workoutEntry(w WorkoutSummary) workoutEntry {
	metrics := w.AvailableMetrics
	if metrics == nil {
		metrics = []string{}
	}
	return workoutEntry{
		UUID:             w.UUID,
		ActivityType:     w.ActivityType,
		Start:            formatInstant(w.Start, s.loc),
		End:              formatInstant(w.End, s.loc),
		DurationS:        round4Ptr(w.DurationS),
		DistanceM:        round4Ptr(w.DistanceM),
		EnergyKcal:       round4Ptr(w.EnergyKcal),
		HasRoute:         w.HasRoute,
		AvailableMetrics: metrics,
	}
}

func (s *service) listWorkouts(ctx context.Context, _ *mcp.CallToolRequest, in workoutsInput) (*mcp.CallToolResult, any, error) {
	f := WorkoutFilters{Limit: in.Limit, Offset: in.Offset, ActivityType: strings.TrimSpace(in.ActivityType)}
	if f.Limit == 0 {
		f.Limit = defaultWorkoutLimit
	}
	if f.Limit < 0 {
		return nil, nil, errors.New("limit must be at least 1")
	}
	if f.Limit > maxWorkoutLimit {
		f.Limit = maxWorkoutLimit
	}
	if f.Offset < 0 {
		return nil, nil, errors.New("offset must be at least 0")
	}

	var start, end time.Time
	if in.StartDate != "" {
		t, err := parseDate(in.StartDate, "start_date", s.loc)
		if err != nil {
			return nil, nil, err
		}
		start = t
		ms := t.UnixMilli()
		f.StartMS = &ms
	}
	if in.EndDate != "" {
		t, err := parseDate(in.EndDate, "end_date", s.loc)
		if err != nil {
			return nil, nil, err
		}
		end = t
		ms := dayAfter(t).UnixMilli()
		f.EndMS = &ms
	}
	if f.StartMS != nil && f.EndMS != nil && end.Before(start) {
		return nil, nil, fmt.Errorf("end_date %s is before start_date %s", end.Format(dateLayout), start.Format(dateLayout))
	}

	page, err := s.api.Workouts(ctx, f)
	if err != nil {
		return nil, nil, err
	}
	out := workoutsOutput{TimeZone: s.loc.String(), Workouts: make([]workoutEntry, 0, len(page.Workouts))}
	for _, w := range page.Workouts {
		out.Workouts = append(out.Workouts, s.workoutEntry(w))
	}
	if len(page.Workouts) == f.Limit {
		next := f.Offset + len(page.Workouts)
		out.NextOffset = &next
	}
	return jsonResult(out)
}

func (s *service) getWorkout(ctx context.Context, _ *mcp.CallToolRequest, in workoutInput) (*mcp.CallToolResult, any, error) {
	uuid := strings.ToLower(strings.TrimSpace(in.UUID))
	if !isUUID(uuid) {
		return nil, nil, fmt.Errorf("uuid %q is not a workout uuid; pass one exactly as returned by list_workouts", in.UUID)
	}
	d, err := s.api.Workout(ctx, uuid)
	if err != nil {
		return nil, nil, err
	}
	out := workoutOutput{workoutEntry: s.workoutEntry(d.WorkoutSummary)}
	if len(d.StatisticsDetail) > 0 {
		out.Statistics = make(map[string]WorkoutStatDetail, len(d.StatisticsDetail))
		for identifier, st := range d.StatisticsDetail {
			out.Statistics[identifier] = WorkoutStatDetail{
				Min: round4Ptr(st.Min),
				Avg: round4Ptr(st.Avg),
				Max: round4Ptr(st.Max),
				Sum: round4Ptr(st.Sum),
			}
		}
	}
	events := d.Events
	if len(events) > maxWorkoutEvents {
		events = events[:maxWorkoutEvents]
		out.EventsTruncated = true
	}
	out.Events = s.humanizeTimes(events)
	out.Activities = s.humanizeTimes(d.Activities)
	return jsonResult(out)
}

// humanizeTimes rewrites epoch-millisecond "start"/"end" values inside the
// free-form event and activity objects (which the API passes through from
// the phone unchanged) as ISO 8601 in the server zone; everything else is
// copied as is.
func (s *service) humanizeTimes(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		m := make(map[string]any, len(item))
		for k, v := range item {
			if f, ok := v.(float64); ok && (k == "start" || k == "end") && f >= 1e11 {
				m[k] = formatInstant(int64(f), s.loc)
				continue
			}
			m[k] = v
		}
		out = append(out, m)
	}
	return out
}
