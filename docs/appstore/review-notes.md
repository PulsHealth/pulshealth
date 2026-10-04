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
  ask for access at `https://app.pulshealth.com/signup` with an address you
  control, approve it on `/admin`, and choose its password from the invite
  email. A household account (`make web-invite`) will not do: its account
  page has no Connect this iPhone, so the reviewer could not pair.
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

The field's limit is 4,000 characters. The block below is 3,837 with the
placeholders and about 3,890 filled in (a 64-character token, a
24-character password) — about 3,950 if each of its 57 line breaks
counts as two, which is the reading to budget for. Any addition needs a
matching cut; measure the filled copy before pasting, and drop the optional
block if it does not fit.

Do not paste a QR image into the notes — the reviewer cannot scan a picture on
the same screen they are reading. The typed path below is the one they will
use; the QR scanner is offered for completeness.

---

## Paste into the Review Notes field

```
WHAT THIS APP IS

PulsHealth copies the user's Apple Health data to a database the user runs, or to the PulsHealth database, which the developer runs for people whose access request they approve. It also works with no database (WITHOUT A DATABASE, below).

DEMO ACCOUNT (PulsHealth database)

  Email:    <<<DEMO_ACCOUNT_EMAIL>>>
  Password: <<<DEMO_ACCOUNT_PASSWORD>>>

An approved account like any user's. It holds no real person's data and is deleted, with its data, after review.

HOW TO EXERCISE THE APP (about 5 minutes)

1. Launch the app. A four-page introduction starts; swipe left to turn pages.
2. On page 2, tap "Continue" (a swipe left does the same). iOS shows its permission sheet: tap "Turn On All", then "Allow" (iOS 27: "Select All", "Continue", then "All Recorded Data and Future Data", "Allow"). The app requests READ access only. Page 3 follows.
3. Swipe to page 4 and tap "Start Exploring". The Explore tab appears.
4. Open the Sync tab, tap "Set Up", choose "PulsHealth Database", then "Sign In to PulsHealth". iOS asks to use app.pulshealth.com to sign in: tap "Continue".
5. Sign in with the demo account, tap "Connect this iPhone", then "Open in PulsHealth". The sheet closes and the app tests the connection.
6. Tap "Save & Apply". The Sync tab shows "PulsHealth Database" with the database's address, and the upload begins.

ACCOUNT DELETION (5.1.1(v)): Sync > Database > "Delete PulsHealth Account" opens the account page, whose "Delete my account" deletes it and its data. Settings > Privacy & Data has the same link.

WHAT YOU SHOULD SEE

The Sync tab's "Samples sent" counter rises if the device has Health data. On an empty device, add a Weight entry in Apple Health (+, Add Data), then pull down on the Sync tab: the counter rises within seconds.

YOUR OWN DATABASE (optional)

The other choice, a database the user runs, pairs by QR code or by typing. To try it: Sync > Database > "Your Own Database", type Database URL <<<REVIEW_SERVER_URL>>> and Token <<<REVIEW_TOKEN>>>, then "Test Connection" and "Save & Apply".

WITHOUT A DATABASE

The Export tab writes the selected Health data to CSV or JSONL files on the device; "Share or Save to Files" opens the iOS share sheet. No network request is made. From a fresh install: do steps 1-3 above and open Export. The files are deleted once shared, and at every launch.

WHY WE DECLARE NSAllowsLocalNetworking

A user's own database often runs on their home network, where a public TLS certificate is impractical. The exception permits plain HTTP to local-network hosts ONLY, and the app enforces the same rule (localhost, *.local, unqualified hostnames, private IP ranges). No NSAllowsArbitraryLoads. The PulsHealth database is HTTPS.

HEALTHKIT (Guideline 5.1.3)

- Read-only. The app never calls a HealthKit write API.
- Health data is not used for advertising, marketing or data mining, and is not shared with any third party. It leaves the app only as uploads to the user's chosen database, or as export files the user shares.
- Never written to iCloud. The app keeps none, except an export the user asked for, in its temporary directory (never backed up) until shared.

CAMERA

Used only to read the pairing QR code. No frame is stored or sent. Declining is handled: the same screen offers "Type It Instead".

URL SCHEME (puls://)

One custom scheme, for pairing links (puls://pair?...), the text a pairing QR code encodes. A link configures nothing by itself: the app asks the user to confirm its host, and accepting only fills in the fields on Sync > Database. The sign-in sheet returns the same kind of link. Either way only "Save & Apply" applies it.

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
developer's own instance, the PulsHealth database, by approved request.

### "Is the app usable without a database?"

Yes, since 1.5 added the on-device export, and since 1.6 the first-run
flow does not ask for a database at all. Its four pages are "Unlock your
Health Data" (Explore, Export, Sync), Health access, one-time exports ("No
account and no database needed"), and "Sync to a database" (the PulsHealth
database or your own), which says it can be set up any time from the Sync tab
and links to pulshealth.com/docs/server/ in Safari. The Sync tab of an install
with no database carries a setup card ("Keep a copy in a database", with a Set
Up button that opens the Database screen and its two choices) instead of
looking broken. The App Store description says the same.

What such an install does *not* do is anything in the background: exports run
only when the user taps Export, in the foreground.

### "Why an account, and how is it deleted?"

The PulsHealth database holds health data for people the developer does not
know, so access is by request: the person asks on
`app.pulshealth.com/signup`, the developer approves, and an email invites
them to choose a password. Signing in happens on that website, in iOS's
`ASWebAuthenticationSession`, and the app never sees the password; what it
receives is the pairing code the account page makes for this iPhone. There
is no third-party or social login, so Sign in with Apple is not required
(4.8). Asking for access happens in the same sheet (Request Access), not in
Safari. Deletion (5.1.1(v)): Delete PulsHealth Account, on Sync → Database
whether or not the iPhone is connected and always under Settings → Privacy &
Data, opens the account page's Delete my account section directly
(`/account#delete-account`). There, Delete my account signs the
person out, disconnects their iPhones at once and has the developer purge
every row stored under their user ID (`docs/privacy-policy.md`, "If you use
the developer's viewer"). Disconnect in the app only stops syncing.

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
