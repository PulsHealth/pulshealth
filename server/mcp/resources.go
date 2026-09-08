package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// guide.md is the LLM-facing manual: what the tools are, the data model in
// brief, units, the double-counting rule, the time-zone rule, and which tool
// answers which question. It is served as a resource so a client can load it
// into context once instead of re-deriving it from tool descriptions.
//
//go:embed guide.md
var guideMarkdown string

const (
	guideURI = "pulshealth://guide"
	typesURI = "pulshealth://types"
)

func (s *service) addResources(server *mcp.Server) {
	server.AddResource(&mcp.Resource{
		URI:      guideURI,
		Name:     "guide",
		Title:    "PulsHealth data guide",
		MIMEType: "text/markdown",
		Description: "How to answer health questions with this server: the tools, the data model in brief, units, " +
			"the iPhone-plus-Watch double-counting rule, cumulative versus discrete metrics, the time-zone rule, " +
			"and question-to-tool recipes. Read it once before answering anything non-trivial.",
	}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI:      guideURI,
			MIMEType: "text/markdown",
			Text:     guideMarkdown,
		}}}, nil
	})

	server.AddResource(&mcp.Resource{
		URI:      typesURI,
		Name:     "types",
		Title:    "Available data types",
		MIMEType: "application/json",
		Description: "The live catalog: every HealthKit type this person has data for, with its unit, row counts and " +
			"earliest/latest timestamps, plus today's date and the server's time zone (the same answer as list_available_types).",
	}, func(ctx context.Context, _ *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		out, err := s.catalog(ctx)
		if err != nil {
			return nil, err
		}
		b, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI:      typesURI,
			MIMEType: "application/json",
			Text:     string(b),
		}}}, nil
	})
}

// Prompts are ready-made requests that spell out which tools to call. They
// are optional sugar: a client that ignores prompts loses nothing.

const weeklySummaryPrompt = `Summarise my health for the week %s to %s (both inclusive; dates are calendar days in the server's time zone).

Do it in this order, and skip a step if list_available_types shows there is no data for it:
1. Call list_available_types once, to see which metrics exist and how current the data is.
2. Call get_activity_rings for the range.
3. Call get_daily_metrics for the range with whichever of these exist: HKQuantityTypeIdentifierStepCount, HKQuantityTypeIdentifierActiveEnergyBurned, HKQuantityTypeIdentifierAppleExerciseTime, HKQuantityTypeIdentifierRestingHeartRate, HKQuantityTypeIdentifierHeartRateVariabilitySDNN, HKQuantityTypeIdentifierBodyMass.
4. Call list_workouts for the range.
5. Call get_sleep for the range if HKCategoryTypeIdentifierSleepAnalysis has data. Each row is one night, dated by the day of waking, in minutes; ignore short daytime naps for the headline figure.
6. Optionally call get_daily_metrics once more for the seven days before the range, so trends have a baseline.

Then write a short summary: how many days closed each ring, the average daily steps with the best and worst day, workouts (count, total time, total distance, the longest one), average time asleep in hours with the best and worst night and the usual deep/REM share, resting heart rate and HRV compared with the previous week if you fetched it, and weight if present. Name the days that have no data rather than treating them as zero, and quote units. Keep it under 250 words.`

const compareWorkoutsPrompt = `Compare my %s workouts in %s with those in %s (calendar months in the server's time zone; today is %s).

1. Call list_workouts with activity_type "%s" for each month (start_date the first of the month, end_date the last; page with offset if next_offset is returned).
2. For each month compute: number of workouts, total and average duration (duration_s), total and average distance (distance_m, report in km and mi), total energy (energy_kcal), and average pace (duration divided by distance) where distance exists.
3. If the workouts list HKQuantityTypeIdentifierHeartRate in available_metrics, call get_workout for the two or three most recent workouts of each month and report the average heart rate from statistics.

Present a side-by-side table, then two or three sentences on what changed. If a month has no workouts, say so. Quote units.`

func (s *service) addPrompts(server *mcp.Server) {
	server.AddPrompt(&mcp.Prompt{
		Name:        "weekly_summary",
		Title:       "Weekly health summary",
		Description: "Summarise the last seven days of rings, steps, workouts and key metrics, ending on a given day (default today).",
		Arguments: []*mcp.PromptArgument{{
			Name:        "week_ending",
			Description: "Last day of the week to summarise, YYYY-MM-DD in the server's time zone; defaults to today",
		}},
	}, func(_ context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		end := s.localNow()
		if v := req.Params.Arguments["week_ending"]; v != "" {
			t, err := parseDate(v, "week_ending", s.loc)
			if err != nil {
				return nil, err
			}
			end = t
		}
		start := end.AddDate(0, 0, -6)
		text := fmt.Sprintf(weeklySummaryPrompt, start.Format(dateLayout), end.Format(dateLayout))
		return &mcp.GetPromptResult{
			Description: fmt.Sprintf("Weekly summary, %s to %s", start.Format(dateLayout), end.Format(dateLayout)),
			Messages:    []*mcp.PromptMessage{{Role: "user", Content: &mcp.TextContent{Text: text}}},
		}, nil
	})

	server.AddPrompt(&mcp.Prompt{
		Name:        "compare_workouts",
		Title:       "Compare this month's workouts with last month's",
		Description: "Compare one activity's workouts in the current calendar month with the previous month: counts, time, distance, pace, heart rate.",
		Arguments: []*mcp.PromptArgument{{
			Name:        "activity_type",
			Description: "snake_case activity name as synced, e.g. running, cycling, walking; defaults to running",
		}},
	}, func(_ context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		activity := req.Params.Arguments["activity_type"]
		if activity == "" {
			activity = "running"
		}
		now := s.localNow()
		thisMonth := now.Format("2006-01")
		lastMonth := now.AddDate(0, -1, -now.Day()+1).Format("2006-01")
		text := fmt.Sprintf(compareWorkoutsPrompt, activity, thisMonth, lastMonth, now.Format(dateLayout), activity)
		return &mcp.GetPromptResult{
			Description: fmt.Sprintf("%s: %s versus %s", activity, thisMonth, lastMonth),
			Messages:    []*mcp.PromptMessage{{Role: "user", Content: &mcp.TextContent{Text: text}}},
		}, nil
	})
}
