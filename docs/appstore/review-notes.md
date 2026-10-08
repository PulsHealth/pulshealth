# App Review notes

Two things live here: the text to paste into **App Store Connect → App Review
Information → Notes** (limit 4000 characters), and the background a maintainer
needs to answer follow-up questions without inventing anything.

## Before you submit

The notes walk the reviewer through a sync to the **PulsHealth database**
with a demo account, the app's account-based path, which App Review signs
in to. A second, optional block covers the your-own-database path against
the throwaway review backend of [`review-backend.md`](review-backend.md).
(The first run and the export path in WITHOUT A DATABASE need neither.)

**The demo account** (maintainer only, at submission time):

- Create it the way a stranger would, so it is a *self-service* account:
  create an account at `https://app.pulshealth.com/signup` (the app's Create
  Account) with an address you control, approve it on `/admin` (a new
  sign-up lands on the waitlist and cannot pair until approved, so the
  reviewer needs this pre-approved account), and choose its password from the invite
  email. An invited personal account can also pair, but use a self-service
  review account so the reviewer can exercise account deletion too.
- Put its email and password in App Store Connect's **Sign-in required**
  fields and in the two placeholders below. Never commit them.
- Its data goes into the production database under its own user ID, so
  delete it after review (see [After approval](#after-approval)).

| Placeholder | What it is |
|---|---|
| `<<<DEMO_ACCOUNT_EMAIL>>>` | The demo account's email address. |
| `<<<DEMO_ACCOUNT_PASSWORD>>>` | Its password. Change it, or delete the account, after review: it ends up in Apple's notes. |
| `<<<REVIEW_SERVER_URL>>>` | Optional block only: the HTTPS URL of the review instance, e.g. `https://review.example.net`. Must be HTTPS and reachable from anywhere. |
| `<<<REVIEW_TOKEN>>>` | Optional block only: its `PULS_TOKEN`. Never reuse it after review. |

Not standing up the review instance? Delete the YOUR OWN DATABASE block
before pasting; nothing else refers to it.

The field's limit is 4,000 characters. Measure the filled copy, including
line breaks. The optional backend block can be removed to leave more room.
Before submission, verify the deployed deletion and backup checks in README.md.
The notes describe the prepared 2.0 behavior, not a claim that it is live.

Do not paste a QR image into the notes — the reviewer cannot scan a picture on
the same screen they are reading. The typed path below is the one they will
use; the QR scanner is offered for completeness.

---

## Paste into the Review Notes field

```
WHAT THIS APP IS

PulsHealth explores and exports Apple Health and syncs it to the user's database or the developer-hosted PulsHealth database. New accounts need approval; use the approved account below. Explore, Export and Data Requests need no account.

DEMO ACCOUNT (PulsHealth database)

  Email:    <<<DEMO_ACCOUNT_EMAIL>>>
  Password: <<<DEMO_ACCOUNT_PASSWORD>>>

This approved account holds no real person’s data. Its records will be purged after review.

HOW TO EXERCISE THE APP (about 5 minutes)

1. Launch the app. Swipe through the four-page introduction.
2. On page 2, Continue opens Health permissions. Allow read access (iOS 27 also asks which history to share; any choice works).
3. Swipe to page 4 and tap "Start Exploring". The Explore tab appears.
4. Sync > Sign In or Create Account > Sign In to PulsHealth. Continue to app.pulshealth.com.
5. Sign in with the review account and tap "Connect this iPhone". The sheet returns directly to the app, which tests the connection.
6. Tap "Save & Apply". The Sync tab shows "PulsHealth Database" with the database's address, and the upload begins.

ACCOUNT DELETION: Settings > Privacy & Data > "Delete PulsHealth Account" > "Delete my account and data". Access stops immediately; records are erased automatically, with retry if interrupted. A private status link confirms completion. No support request is needed.

WHAT YOU SHOULD SEE

On an empty device, add a Weight entry in Apple Health, then pull down on Sync. Samples sent rises once uploaded.

YOUR OWN DATABASE (optional)

Sync > Database > "Your Own Database": enter Database URL <<<REVIEW_SERVER_URL>>> and Token <<<REVIEW_TOKEN>>>, then "Test Connection" and "Save & Apply".

WITHOUT A DATABASE

After steps 1-3, open Export to create CSV or JSONL files. Share or Save to Files opens the share sheet. No network request is made; temporary files are deleted after sharing and at launch.

WHY WE DECLARE NSAllowsLocalNetworking

HTTP is allowed only for local-network databases (localhost, *.local, unqualified names, private IPs), enforced in app validation. No NSAllowsArbitraryLoads. Public databases and the PulsHealth database require HTTPS.

HEALTHKIT (Guideline 5.1.3)

- Read-only. The app never calls a HealthKit write API.
- Health data is not used for advertising, marketing or data mining, and is not sold. It leaves the app as sync to the configured database, exports the user shares, or one-time request delivery explicitly approved by the user.
- Health samples are staged only for requested exports, in temporary storage excluded from backup. Analysis summaries stay on-device and are also backup-excluded.

CAMERA

Used to read database pairing and Data Request QR codes. No frame is stored or sent. Declining is handled: the same screen offers "Type It Instead".

URL SCHEME (puls://)

puls://pair links ask for host confirmation and fill database fields; only Save & Apply applies them. The sign-in sheet returns a pairing link. puls://request links show data, dates, purpose and recipient before any read or delivery.

DATA REQUESTS

Settings > Create Request: choose types and dates, leave direct delivery off, create a link, then open it via Settings > Open or Scan Request. Review and tap Generate & Share for a ZIP. HTTPS delivery uses Generate & Send to the displayed receiver; partial exports require Send Available Data. There is no ongoing sync, study enrollment or research consent process.

BACKGROUND MODES

"processing" plus HealthKit background delivery, so new samples upload without opening the app.

Source (Apache-2.0): https://github.com/PulsHealth/pulshealth
Privacy policy: https://pulshealth.com/privacy
```

---

## Background for follow-up questions

### "Why does the app need an external database at all?"

It does not, for a one-off: the Export tab writes the selected Health
data to CSV or JSONL files on the device and hands them to the share sheet,
with no database and no network request, and the Explore tab shows what Apple
Health holds without either. The database is for the thing a file
cannot do — *continuous* sync into a database the user controls, so they can
query it with SQL, chart it in Grafana, or feed it to their own tools as new
data arrives. This is the same shape as other HealthKit exporters on the store;
the difference is that the destination is the user's own machine rather than a
vendor's cloud, which is the feature, not a limitation. For someone who wants
continuous sync without running a database, the app also offers the
developer's own instance, the PulsHealth database, with a PulsHealth account.

### "Is the app usable without a database?"

Yes, since 1.5 added the on-device export, and since 1.6 the first-run
flow does not ask for a database at all. Its four pages are "Unlock your
Health Data" (Explore, Export, Sync), Health access, one-time exports ("No
account and no database needed"), and "Always in sync" (the PulsHealth
database or your own), which says it is optional and can be set up any time
from the Sync tab, and links to pulshealth.com/#ways in Safari. The Sync tab
of an install with no database explains syncing and offers the two choices
(each opens the Database screen) instead of looking broken. The App Store description says the same.

What such an install does *not* do is anything in the background: exports run
only when the user taps Export, in the foreground.

### "Why an account, and how is it deleted?"

The PulsHealth database holds health data for people the developer does not
know, so new accounts are let in by hand: the person creates an account on
`app.pulshealth.com/signup` (Create Account in the app), the developer
approves it, and an email invites them to choose a password. Signing in happens on that website, in iOS's
`ASWebAuthenticationSession`, and the app never sees the password; what it
receives is the pairing code the connection page makes for this iPhone. There
is no third-party or social login, so Sign in with Apple is not required
(4.8). Creating an account happens in the same sheet (Create Account), not in
Safari. Deletion (5.1.1(v)): Delete PulsHealth Account under Settings → Privacy &
Data, whether or not the iPhone is connected, opens the account page's deletion
section directly (`/account#delete-account`). Delete my account and data signs
the person out and disconnects their iPhones, then automatically erases the
account and records, with retry if interrupted. A private receipt page distinguishes
pending from completed removal. Approved signups and operator-designated invited
personal accounts use this flow. No support email or manual approval is needed.
The minimal UUID/date restore-suppression ledger is retained indefinitely;
receipt hashes expire 30 days after completion. Older backups are subject to
retention and must have deletions replayed before being reopened. Confirm the
hosted retention configuration before submission. Disconnect in the app only
stops syncing.

### "Where do exported files go, and what is in them?"

Into the app's temporary directory (never backed up), then to the iOS share
sheet. The app deletes its copy when the share sheet reports completion, on
Delete Export, when another export starts, and at every launch. The files hold
the selected health data plus a manifest with the user ID, the app's random
device ID, the time zone and row counts — no token, no database URL, and none of
the name/e-mail/date-of-birth fields from Settings → User. The share sheet's
Copy action is excluded. `docs/privacy-policy.md` § Exports is the public
statement of all this.

### "The permission sheet asked how much data to share"

That is iOS 27's second page. *Past 30 Days and Future Data* works too: the app
then reads, syncs and exports only from 30 days back, says so on the Sync tab,
an analysis and an export result, never treats the older history as deleted
or empty in the database, and reads the rest by itself if access is widened
later under Settings → Privacy & Security → Health → PulsHealth. *Don't Allow*
on that page is taken as the user's answer: no error, nothing read. The notes
ask for All Recorded Data only so the reviewer sees a whole history arrive.

### "Does the app read the clipboard?"

Only when the user taps Paste Pairing Code, which is the system paste button
(`PasteButton`): iOS shows no paste prompt, and nothing is read otherwise.

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

Record the six steps above on a device with a little Health data in it, using
the demo account. Show the sign-in sheet, the Test Connection success row and
the Sync tab's counter moving, then Delete PulsHealth Account opening the
account page (without deleting), and the Export tab through to the share
sheet. Do not use a real person's health history.

### After approval

Delete the demo account and everything synced to it: on `/admin`, disable it
(which revokes its tokens) and **Purge** its data (`web/README.md`, "Access
requests"). If the review instance was stood up, take it down
([`review-backend.md`](review-backend.md) § 6).

### Native App Store review requests (next submission)

Settings → About → Write a Review permanently opens the App Store review
page. Automatic requests use Apple's native prompt directly after a complete
shared export, a visible successful upload or a return from a populated
analysis, once the local usage thresholds are met. Navigation, backgrounding,
modals and unfinished work suppress requests. Attempts are spaced at least
120 days apart and occur at most once per app version; Apple controls whether
a prompt is shown. There is no satisfaction pre-prompt, reward or filtering by
an expressed rating. The on-device timing counters contain no health values
and are not sent to the developer. This flow does not appear in TestFlight.

### Data Requests (next release)

Settings → Create Request builds a self-contained link and QR code without a
HealthKit read. Choose data types, past dates and CSV or JSONL. Leave delivery
off to test Generate & Share without a receiver. Open the link or use Settings
→ Open or Scan Request. Review the request, then generate. Requests with a
compatible HTTPS endpoint combine generation and sending in one explicit action.
A partial extraction requires Send Available Data; an unconfirmed receipt allows
manual retry with the same submission ID. No ongoing collection, participant
account, institutional verification, or study enrollment is implemented.
See docs/requests.md for the receiver contract. Use synthetic data for review.
