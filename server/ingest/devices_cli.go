package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"
)

// `ingest devices …`: the operator's side of per-device tokens (SRV-8). The
// image is distroless, so this runs as
//
//	docker compose run --rm --no-deps ingest devices <subcommand>
//
// (`make devices ARGS='…'` from the repository root), reusing the container's
// DATABASE_URL. Plain text on stdout, errors on stderr, exit 2 on a usage
// error and 1 on anything else.

const devicesUsage = `usage: ingest devices <command>

  list [--all]                        active tokens; --all includes revoked ones
  issue --user <uuid> --name <label>  mint a token for a user (creates the user
                                      row if needed — a mistyped UUID makes a
                                      new user) and print it once
  revoke <id>                         refuse the token from the next request on
  rename <id> <label>                 change a token's label
`

// devicesCommand is a parsed `devices` invocation.
type devicesCommand struct {
	op     string // list | issue | revoke | rename
	all    bool
	userID string
	name   string
	id     int64
}

// parseDevicesArgs is pure so it can be unit-tested without a database.
func parseDevicesArgs(args []string) (devicesCommand, error) {
	if len(args) == 0 {
		return devicesCommand{}, errors.New("missing command")
	}
	cmd := devicesCommand{op: args[0]}
	rest := args[1:]
	switch cmd.op {
	case "list":
		for _, a := range rest {
			switch a {
			case "--all", "-a":
				cmd.all = true
			default:
				return devicesCommand{}, fmt.Errorf("list: unknown argument %q", a)
			}
		}
	case "issue":
		for i := 0; i < len(rest); i++ {
			key, value, inline := strings.Cut(rest[i], "=")
			if !inline {
				if i+1 >= len(rest) {
					return devicesCommand{}, fmt.Errorf("issue: %s needs a value", key)
				}
				i++
				value = rest[i]
			}
			switch key {
			case "--user":
				cmd.userID = value
			case "--name":
				cmd.name = value
			default:
				return devicesCommand{}, fmt.Errorf("issue: unknown argument %q", key)
			}
		}
		if cmd.userID == "" {
			return devicesCommand{}, errors.New("issue: --user <uuid> is required")
		}
		if !isUUID(cmd.userID) {
			return devicesCommand{}, fmt.Errorf("issue: --user %q is not a UUID", cmd.userID)
		}
		if cmd.name == "" {
			return devicesCommand{}, errors.New("issue: --name <label> is required")
		}
		if err := validateDeviceName(cmd.name); err != nil {
			return devicesCommand{}, fmt.Errorf("issue: %w", err)
		}
	case "revoke", "rename":
		want := 1
		if cmd.op == "rename" {
			want = 2
		}
		if len(rest) != want {
			return devicesCommand{}, fmt.Errorf("%s: wrong number of arguments", cmd.op)
		}
		id, err := strconv.ParseInt(rest[0], 10, 64)
		if err != nil || id <= 0 {
			return devicesCommand{}, fmt.Errorf("%s: %q is not a token id", cmd.op, rest[0])
		}
		cmd.id = id
		if cmd.op == "rename" {
			cmd.name = rest[1]
			if err := validateDeviceName(cmd.name); err != nil {
				return devicesCommand{}, fmt.Errorf("rename: %w", err)
			}
		}
	default:
		return devicesCommand{}, fmt.Errorf("unknown command %q", cmd.op)
	}
	return cmd, nil
}

// runDevicesCLI is main's branch for `ingest devices …`; it returns the
// process exit code.
func runDevicesCLI(args []string, stdout, stderr io.Writer) int {
	cmd, err := parseDevicesArgs(args)
	if err != nil {
		fmt.Fprintf(stderr, "ingest devices: %v\n\n%s", err, devicesUsage)
		return 2
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintln(stderr, "ingest devices: DATABASE_URL must be set")
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	// Connection chatter belongs on stderr: stdout is the answer.
	pool, err := connectWithRetry(ctx, dbURL, slog.New(slog.NewTextHandler(stderr, nil)))
	if err != nil {
		fmt.Fprintf(stderr, "ingest devices: %v\n", err)
		return 1
	}
	defer pool.Close()
	if err := runDevicesCommand(ctx, NewStore(pool), cmd, stdout); err != nil {
		fmt.Fprintf(stderr, "ingest devices: %v\n", err)
		return 1
	}
	return 0
}

func runDevicesCommand(ctx context.Context, store *Store, cmd devicesCommand, out io.Writer) error {
	switch cmd.op {
	case "list":
		tokens, err := store.ListDeviceTokens(ctx, cmd.all)
		if err != nil {
			return err
		}
		printDeviceTokens(out, tokens, cmd.all)
	case "issue":
		plaintext, d, err := store.IssueDeviceToken(ctx, cmd.userID, cmd.name)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "Issued device token %d (%s…) for user %s.\n\n", d.ID, d.TokenPrefix, d.UserID)
		fmt.Fprintf(out, "  Token    %s\n  User ID  %s\n\n", plaintext, d.UserID)
		fmt.Fprintln(out, "Enter both in the app under Settings > Server. This is the only time the token")
		fmt.Fprintln(out, "is shown: only its hash is stored, so a lost token is revoked and reissued,")
		fmt.Fprintln(out, "never recovered.")
	case "revoke":
		if err := store.RevokeDeviceToken(ctx, cmd.id); err != nil {
			return err
		}
		fmt.Fprintf(out, "Revoked device token %d; the next request that presents it gets 401.\n", cmd.id)
	case "rename":
		if err := store.RenameDeviceToken(ctx, cmd.id, cmd.name); err != nil {
			return err
		}
		fmt.Fprintf(out, "Renamed device token %d to %q.\n", cmd.id, cmd.name)
	}
	return nil
}

func printDeviceTokens(out io.Writer, tokens []deviceToken, all bool) {
	if len(tokens) == 0 {
		if all {
			fmt.Fprintln(out, "No device tokens. Issue one: ingest devices issue --user <uuid> --name <label>")
		} else {
			fmt.Fprintln(out, "No active device tokens (--all shows revoked ones). Issue one: ingest devices issue --user <uuid> --name <label>")
		}
		return
	}
	stamp := func(t *time.Time) string {
		if t == nil {
			return "never"
		}
		return t.UTC().Format("2006-01-02 15:04")
	}
	w := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tPREFIX\tSTATUS\tUSER\tNAME\tCREATED\tLAST SEEN")
	for _, d := range tokens {
		fmt.Fprintf(w, "%d\t%s…\t%s\t%s\t%s\t%s\t%s\n",
			d.ID, d.TokenPrefix, d.Status, d.UserID, d.Name, stamp(&d.CreatedAt), stamp(d.LastSeenAt))
	}
	w.Flush()
}
