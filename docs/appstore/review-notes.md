# App Review notes

Two things live here: the text to paste into **App Store Connect → App Review
Information → Notes** (limit 4000 characters), and the background a maintainer
needs to answer follow-up questions without inventing anything.

## Before you submit

Fill in the four placeholders below with the values from the throwaway review
backend. Standing that up is [`review-backend.md`](review-backend.md); do it
first: the notes walk the reviewer through a sync, and that needs it. (The
export path in the notes' WITHOUT A SERVER section does not.)

| Placeholder | What it is |
|---|---|
| `<<<REVIEW_SERVER_URL>>>` | The HTTPS URL of the review instance, e.g. `https://review.example.net`. Must be HTTPS and reachable from anywhere. |
| `<<<REVIEW_TOKEN>>>` | Its `PULS_TOKEN`. Rotate it after review. |
| `<<<REVIEW_USER_ID>>>` | The user UUID, `5ea4d000-0000-4000-8000-000000000001` unless you changed it. |
| `<<<REVIEW_EXPIRY>>>` | The date you intend to take the instance down. Keep it up until the app is approved. |

The field's limit is 4000 characters and the filled-in block below is about
3,930 (3,990 if line breaks count twice), so any addition needs a matching
cut. Measure the filled copy before pasting — the block has overrun before
(the `puls://` section took it to about 4,800 until the export section forced
a recount).

Do not paste a QR image into the notes — the reviewer cannot scan a picture on
the same screen they are reading. The typed path below is the one they will
use; the QR scanner is offered for completeness.

---

## Paste into the Review Notes field

```
WHAT THIS APP IS

PulsHealth copies the user's Apple Health data to a server that the USER runs. There is no developer-operated backend. The app uploads only to the address the user enters. No health data reaches the developer.

Syncing needs a server, so we have stood one up: a throwaway instance that exists only for this review and holds no real person's data. The app also works with no server at all (WITHOUT A SERVER, below).

REVIEW SERVER

  Server URL: <<<REVIEW_SERVER_URL>>>
  Token:      <<<REVIEW_TOKEN>>>
  User ID:    <<<REVIEW_USER_ID>>>

Up until at least <<<REVIEW_EXPIRY>>>. If it is unreachable, please contact us before rejecting; we will bring it back the same day.

HOW TO EXERCISE THE APP (about 5 minutes)

1. Launch the app. A five-step first-run flow starts.
2. "Get Started".
3. On "Your Server", type the Server URL and Token above into the two fields. ("Scan Pairing Code" needs a physical QR code, so please type.) iOS may offer to save the token; either answer is fine.
4. Tap "Test Connection". It should report success. Then "Continue".
5. On "Health Access", tap "Continue". iOS shows its permission sheet: "Turn On All", then Allow. The app requests READ access only.
6. On "Data Types", a starter selection is already made. Tap "Continue".
7. On "Ready", tap "Start Syncing". The Dashboard appears and the upload begins.

WHAT YOU SHOULD SEE

- The Dashboard's "Samples exported" counter rises if the device has Health data. A new device may have none; that is expected.
- On an empty device: in Apple Health, search for Weight, open it, tap + (Add Data), enter a value and save. Back in PulsHealth, pull down on the Dashboard: the counter rises within seconds.
- The Log tab shows every upload.

WITHOUT A SERVER

Settings > Export Data (also on the Dashboard when no server is set) writes the selected Health data to CSV or JSONL files on the device; "Share or Save to Files" opens the iOS share sheet. No network request is made. From a fresh install: on "Your Server" tap "I'll Set This Up Later", continue, tap "Finish". The files sit in the app's temporary directory and are deleted once shared, and at every launch.

WHY WE DECLARE NSAllowsLocalNetworking

Self-hosted servers often sit on the user's own network, where a public TLS certificate is impractical. The exception permits plain HTTP to local-network hosts ONLY, and the app enforces the same rule itself: http:// is accepted only for localhost, *.local, an unqualified hostname or a private IP range. We do not set NSAllowsArbitraryLoads. The review server is HTTPS.

HEALTHKIT (Guideline 5.1.3)

- Read-only. The app never calls a HealthKit write API.
- Health data is not used for advertising, marketing or data mining, and is not shared with any third party. It leaves the app only as uploads to the user's server, or as export files the user sends through the share sheet.
- Never written to iCloud. The app keeps none, except an export the user asked for, in its temporary directory (never backed up) until shared.

CAMERA

Used only to read the pairing QR code. No frame is stored or sent. Declining is handled: the same screen offers "Type It Instead".

URL SCHEME (puls://)

One custom scheme, for pairing links (puls://pair?...) — the text the server's QR code encodes, so the iOS Camera app can open it. Any page or app can fire such a URL, so a link configures nothing by itself: the app shows a confirmation naming the server's host, and accepting only fills in the server fields — the user still has to finish setup or tap Save & Apply. "Paste Pairing Code" uses the system paste button.

BACKGROUND MODES

"processing" plus HealthKit background delivery, so new samples upload without opening the app. There are no accounts, so no demo account.

Source (Apache-2.0): https://github.com/PulsHealth/pulshealth
Privacy policy: https://pulshealth.com/privacy
```

---

## Background for follow-up questions

### "Why does the app need an external server at all?"

It does not, for a one-off: Settings → Export Data writes the selected Health
data to CSV or JSONL files on the device and hands them to the share sheet,
with no server and no network request. The server is for the thing a file
cannot do — *continuous* sync into a database the user controls, so they can
query it with SQL, chart it in Grafana, or feed it to their own tools as new
data arrives. This is the same shape as other HealthKit exporters on the store;
the difference is that the destination is the user's own machine rather than a
vendor's cloud, which is the feature, not a limitation.

### "Is the app usable without a server?"

Yes, since the version that added Export Data. The first-run flow says so
before it asks for a server: the welcome screen lists "A server, for continuous
sync" and then "Or no server at all — export the same data to CSV or JSONL
files on this iPhone whenever you like". The server step's way past ("I'll Set
This Up Later") says where it leads, the last step says nothing will be
uploaded and points at Settings → Export Data, and the Dashboard of an install
with no server carries a "No server set up" card with an "Export Data to Files"
link instead of looking broken. The App Store description says the same.

What such an install does *not* do is anything in the background: exports run
only when the user taps Export, in the foreground.

### "Where do exported files go, and what is in them?"

Into the app's temporary directory (never backed up), then to the iOS share
sheet. The app deletes its copy when the share sheet reports completion, on
Delete Export, when another export starts, and at every launch. The files hold
the selected health data plus a manifest with the user ID, the app's random
device ID, the time zone and row counts — no token, no server URL, and none of
the name/e-mail/date-of-birth fields from Settings → User. The share sheet's
Copy action is excluded. `docs/privacy-policy.md` § Exports is the public
statement of all this.

### "Prove the local-network exception is narrow"

`PulsHealthSync/Sources/PulsHealthSync/Transport/ServerURLValidation.swift` is
the whole rule, and
`PulsHealthSync/Tests/PulsHealthSyncTests/` covers it, including the case where
a scanned pairing code carries plain HTTP to a public host — it is rejected
rather than saved. `Info.plist` sets only `NSAllowsLocalNetworking`;
`NSAllowsArbitraryLoads` is absent.

### "What about the health data you can read — ECG, State of Mind, medications?"

They are in the catalogue and are off unless the user turns them on, exactly
like every other type. Enabling one triggers the iOS permission sheet for it.
The app does not interpret any of them; it copies them.

### If review asks for a video

Record the seven steps above on a device with a little Health data in it. Show
the Test Connection success row and the Dashboard counter moving, then
Settings → Export Data through to the share sheet. Do not use a
real person's health history.

### After approval

1. Take the review instance down (`docker compose down -v` in its directory).
2. Rotate `PULS_TOKEN` even so, in case the notes are cached anywhere.
3. Update `<<<REVIEW_EXPIRY>>>` here for the next submission rather than
   leaving a stale date.
