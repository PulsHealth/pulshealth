// Command protocol-check validates Puls Sync Protocol v1 batches (plain or
// gzipped NDJSON) against the JSON Schemas in docs/protocol/schema and the
// structural rules the schemas cannot express: the header counts must match
// the lines that follow, in wire order, with nothing trailing.
//
// It is the conformance half of the protocol documentation: `go test ./...`
// validates every fixture in docs/protocol/fixtures, and the binary validates
// any batch a sender or receiver author captures.
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// SchemaBase is the $id prefix every schema file must carry: its file name
// appended to this URL. Relative $refs between the files resolve against it,
// and the compiler is fed every file under that URL so nothing is fetched.
const SchemaBase = "https://raw.githubusercontent.com/PulsHealth/pulshealth/main/docs/protocol/schema/"

// maxLineBytes mirrors the reference server's per-line scanner limit.
const maxLineBytes = 4 * 1024 * 1024

// lineType is one of the seven shapes a line after the header can take.
// Wrapped lines carry exactly one top-level key; a sample line carries none.
type lineType struct {
	Name       string // schema file name without .schema.json
	Key        string // wrapper key, empty for a sample
	CountField string // header field that declares how many follow
}

// LineTypes is the wire order: the header's counts are consumed in this order.
var LineTypes = []lineType{
	{"sample", "", "sampleCount"},
	{"deletion", "deleted", "deletionCount"},
	{"route", "route", "routeCount"},
	{"series", "series", "seriesCount"},
	{"aggregate", "aggregate", "aggregateCount"},
	{"activity-summary", "activitySummary", "activitySummaryCount"},
	{"profile", "profile", "profileCount"},
}

// Validator holds the compiled schemas.
type Validator struct {
	schemas map[string]*jsonschema.Schema
}

// NewValidator loads every *.schema.json in dir. Each file's $id must be
// SchemaBase plus its file name, so the corpus cannot silently drift from the
// published identifiers.
func NewValidator(dir string) (*Validator, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.schema.json"))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("no *.schema.json files in %s", dir)
	}
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	var ids []string
	for _, path := range paths {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		doc, err := jsonschema.UnmarshalJSON(f)
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		obj, _ := doc.(map[string]any)
		id, _ := obj["$id"].(string)
		if want := SchemaBase + filepath.Base(path); id != want {
			return nil, fmt.Errorf("%s: $id is %q, want %q", path, id, want)
		}
		if err := c.AddResource(id, doc); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		ids = append(ids, id)
	}
	v := &Validator{schemas: map[string]*jsonschema.Schema{}}
	for _, id := range ids {
		name := strings.TrimSuffix(strings.TrimPrefix(id, SchemaBase), ".schema.json")
		sch, err := c.Compile(id)
		if err != nil {
			return nil, fmt.Errorf("compile %s: %w", name, err)
		}
		v.schemas[name] = sch
	}
	for _, name := range append([]string{"header", "batch-line"}, lineTypeNames()...) {
		if v.schemas[name] == nil {
			return nil, fmt.Errorf("schema %s.schema.json missing from %s", name, dir)
		}
	}
	return v, nil
}

func lineTypeNames() []string {
	names := make([]string, len(LineTypes))
	for i, lt := range LineTypes {
		names[i] = lt.Name
	}
	return names
}

// Schema returns the compiled schema for a name such as "header" or "sample".
func (v *Validator) Schema(name string) *jsonschema.Schema { return v.schemas[name] }

// Validate checks one decoded JSON document (as produced by
// jsonschema.UnmarshalJSON or encoding/json) against the named schema.
func (v *Validator) Validate(name string, doc any) error {
	sch := v.schemas[name]
	if sch == nil {
		return fmt.Errorf("unknown schema %q", name)
	}
	return sch.Validate(doc)
}

// Summary describes a batch that passed structural validation.
type Summary struct {
	Header       map[string]any
	Counts       map[string]int // lines seen per line type name
	Kinds        map[string]int // sample kinds seen
	RoutePoints  int
	SeriesPoints int
	Versioned    bool // header carried schemaVersion
}

// ValidateBatch reads a whole batch, gunzipping it if it starts with the gzip
// magic, and returns a summary plus every problem found. A header that fails
// its schema is fatal (its counts drive the rest); later problems are
// collected so one run reports them all.
func (v *Validator) ValidateBatch(r io.Reader) (*Summary, []error) {
	br := bufio.NewReader(r)
	if magic, err := br.Peek(2); err == nil && magic[0] == 0x1f && magic[1] == 0x8b {
		gz, err := gzip.NewReader(br)
		if err != nil {
			return nil, []error{fmt.Errorf("invalid gzip body: %w", err)}
		}
		defer gz.Close()
		br = bufio.NewReader(gz)
	}
	sc := bufio.NewScanner(br)
	sc.Buffer(make([]byte, 64*1024), maxLineBytes)
	lineNo := 0
	next := func() ([]byte, bool) {
		for sc.Scan() {
			lineNo++
			if len(bytes.TrimSpace(sc.Bytes())) == 0 {
				continue
			}
			return sc.Bytes(), true
		}
		return nil, false
	}

	line, ok := next()
	if !ok {
		if err := sc.Err(); err != nil {
			return nil, []error{fmt.Errorf("reading header line: %w", err)}
		}
		return nil, []error{errors.New("empty body: missing batch header")}
	}
	doc, err := decode(line)
	if err != nil {
		return nil, []error{fmt.Errorf("line 1: header is not valid JSON: %w", err)}
	}
	if err := v.Validate("header", doc); err != nil {
		return nil, []error{fmt.Errorf("line 1: header: %w", err)}
	}
	header := doc.(map[string]any)
	sum := &Summary{Header: header, Counts: map[string]int{}, Kinds: map[string]int{}}
	_, sum.Versioned = header["schemaVersion"]

	var errs []error
	for _, lt := range LineTypes {
		n, err := intField(header, lt.CountField)
		if err != nil {
			errs = append(errs, fmt.Errorf("line 1: header %s: %w", lt.CountField, err))
			continue
		}
		for i := 0; i < n; i++ {
			line, ok := next()
			if !ok {
				errs = append(errs, fmt.Errorf("%s %d/%d: unexpected end of body", lt.Name, i+1, n))
				return sum, errs
			}
			doc, err := decode(line)
			if err != nil {
				errs = append(errs, fmt.Errorf("line %d: not valid JSON: %w", lineNo, err))
				continue
			}
			got, err := classify(doc)
			if err != nil {
				errs = append(errs, fmt.Errorf("line %d: %w", lineNo, err))
				continue
			}
			if got.Name != lt.Name {
				errs = append(errs, fmt.Errorf("line %d: header counts call for a %s line here, found a %s line", lineNo, lt.Name, got.Name))
				continue
			}
			if err := v.Validate(lt.Name, doc); err != nil {
				errs = append(errs, fmt.Errorf("line %d (%s): %w", lineNo, lt.Name, err))
				continue
			}
			if err := semanticChecks(lt, doc.(map[string]any), sum); err != nil {
				errs = append(errs, fmt.Errorf("line %d (%s): %w", lineNo, lt.Name, err))
				continue
			}
			sum.Counts[lt.Name]++
		}
	}
	if _, ok := next(); ok {
		errs = append(errs, fmt.Errorf("line %d: trailing line after the declared counts", lineNo))
	}
	if err := sc.Err(); err != nil {
		errs = append(errs, fmt.Errorf("reading body: %w", err))
	}
	return sum, errs
}

// decode parses one JSON line the way the schema library expects (numbers as
// json.Number, so integer checks and large epoch values are exact).
func decode(line []byte) (any, error) {
	return jsonschema.UnmarshalJSON(bytes.NewReader(line))
}

// classify identifies a line by its wrapper key. A line with none is a sample;
// a line with more than one is malformed.
func classify(doc any) (lineType, error) {
	obj, ok := doc.(map[string]any)
	if !ok {
		return lineType{}, errors.New("line is not a JSON object")
	}
	var found []lineType
	for _, lt := range LineTypes[1:] {
		if _, ok := obj[lt.Key]; ok {
			found = append(found, lt)
		}
	}
	switch len(found) {
	case 0:
		return LineTypes[0], nil
	case 1:
		return found[0], nil
	default:
		keys := make([]string, len(found))
		for i, lt := range found {
			keys[i] = lt.Key
		}
		return lineType{}, fmt.Errorf("line carries several wrapper keys (%s)", strings.Join(keys, ", "))
	}
}

// semanticChecks covers the rules the reference server enforces that JSON
// Schema cannot state, and gathers the summary counts.
func semanticChecks(lt lineType, obj map[string]any, sum *Summary) error {
	switch lt.Name {
	case "sample":
		kind, _ := obj["kind"].(string)
		sum.Kinds[kind]++
	case "route":
		inner, _ := obj["route"].(map[string]any)
		points, _ := inner["points"].([]any)
		sum.RoutePoints += len(points)
	case "series":
		inner, _ := obj["series"].(map[string]any)
		points, _ := inner["points"].([]any)
		sum.SeriesPoints += len(points)
	case "aggregate":
		inner, _ := obj["aggregate"].(map[string]any)
		start, err1 := numberField(inner, "bucketStart")
		end, err2 := numberField(inner, "bucketEnd")
		if err1 == nil && err2 == nil && end <= start {
			return errors.New("bucketEnd must be after bucketStart")
		}
	}
	return nil
}

// intField reads an integer header field; absent means 0, as on the reference
// server.
func intField(obj map[string]any, name string) (int, error) {
	raw, ok := obj[name]
	if !ok || raw == nil {
		return 0, nil
	}
	f, err := numberField(obj, name)
	if err != nil {
		return 0, err
	}
	n := int(f)
	if float64(n) != f {
		return 0, fmt.Errorf("%v is not an integer", raw)
	}
	return n, nil
}

func numberField(obj map[string]any, name string) (float64, error) {
	switch x := obj[name].(type) {
	case json.Number:
		return x.Float64()
	case float64:
		return x, nil
	case nil:
		return 0, fmt.Errorf("missing %s", name)
	default:
		return 0, fmt.Errorf("%s is not a number", name)
	}
}
