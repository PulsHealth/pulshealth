package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	schemaDir := flag.String("schemas", "", "directory holding the *.schema.json files (default: docs/protocol/schema, searched upwards from the working directory)")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: protocol-check [-schemas DIR] BATCH.ndjson[.gz] ...\n\n"+
			"Validates each Puls Sync Protocol v1 batch against the JSON Schemas and the\n"+
			"header-count and line-order rules. Exit status 1 if any batch fails.\n")
		flag.PrintDefaults()
	}
	flag.Parse()
	if flag.NArg() == 0 {
		flag.Usage()
		os.Exit(2)
	}
	dir := *schemaDir
	if dir == "" {
		var err error
		if dir, err = findSchemaDir(); err != nil {
			fmt.Fprintln(os.Stderr, "protocol-check:", err)
			os.Exit(2)
		}
	}
	v, err := NewValidator(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "protocol-check:", err)
		os.Exit(2)
	}

	failed := false
	for _, path := range flag.Args() {
		f, err := os.Open(path)
		if err != nil {
			fmt.Fprintf(os.Stderr, "FAIL %s: %v\n", path, err)
			failed = true
			continue
		}
		sum, errs := v.ValidateBatch(f)
		f.Close()
		if len(errs) > 0 {
			failed = true
			fmt.Printf("FAIL %s\n", path)
			for _, e := range errs {
				fmt.Printf("  %v\n", e)
			}
			continue
		}
		fmt.Printf("OK   %s: %s\n", path, describe(sum))
	}
	if failed {
		os.Exit(1)
	}
}

func describe(sum *Summary) string {
	version := "legacy header"
	if sum.Versioned {
		version = fmt.Sprintf("schemaVersion %v", sum.Header["schemaVersion"])
	}
	return fmt.Sprintf("%s; %d samples, %d deletions, %d routes (%d points), %d series (%d points), %d aggregates, %d activity summaries, %d profile",
		version, sum.Counts["sample"], sum.Counts["deletion"], sum.Counts["route"], sum.RoutePoints,
		sum.Counts["series"], sum.SeriesPoints, sum.Counts["aggregate"], sum.Counts["activity-summary"], sum.Counts["profile"])
}

// findSchemaDir walks up from the working directory looking for
// docs/protocol/schema, so the tool works from the repository root and from
// tools/protocol-check alike.
func findSchemaDir() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(dir, "docs", "protocol", "schema")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("docs/protocol/schema not found above %s; pass -schemas", dir)
		}
		dir = parent
	}
}
