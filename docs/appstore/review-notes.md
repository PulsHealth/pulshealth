# App Review notes

Two things live here: the text to paste into **App Store Connect → App Review
Information → Notes** (limit 4000 characters), and the background a maintainer
needs to answer follow-up questions without inventing anything.

## Before you submit

Fill in the four placeholders below with the values from the throwaway review
backend. Standing that up is [`review-backend.md`](review-backend.md); do it
first, because the notes are useless without it.

| Placeholder | What it is |
|---|---|
| `<<<REVIEW_SERVER_URL>>>` | The HTTPS URL of the review instance, e.g. `https://review.example.net`. Must be HTTPS and reachable from anywhere. |
| `<<<REVIEW_TOKEN>>>` | Its `PULS_TOKEN`. Rotate it after review. |
| `<<<REVIEW_USER_ID>>>` | The user UUID, `5ea4d000-0000-4000-8000-000000000001` unless you changed it. |
| `<<<REVIEW_EXPIRY>>>` | The date you intend to take the instance down. Keep it up until the app is approved. |

Do not paste a QR image into the notes — the reviewer cannot scan a picture on
the same screen they are reading. The typed path below is the one they will
use; the QR scanner is offered for completeness.

---

## Paste into the Review Notes field

```
WHAT THIS APP IS

PulsHealth copies the user's Apple Health data to a server that the USER runs. There is no PulsHealth service and no developer-operated backend. The app uploads only to the address the user enters. No health data — none — reaches the developer.

Because of that, the app cannot be exercised without a server. We have stood one up for you. It is a throwaway instance that exists only for this review, contains no real person's data, and its credentials will be rotated afterwards.

REVIEW SERVER

  Server URL: <<<REVIEW_SERVER_URL>>>
  Token:      <<<REVIEW_TOKEN>>>
  User ID:    <<<REVIEW_USER_ID>>>

The instance will stay up until at least <<<REVIEW_EXPIRY>>>. If it is unreachable, please contact us before rejecting; we will bring it back up the same day.

HOW TO EXERCISE THE APP (about 5 minutes)

1. Launch the app. A five-step first-run flow starts automatically.
2. "Get Started".
3. On "Your Server", type the Server URL above into the URL field and the Token into the Bearer token field. ("Scan Pairing Code" reads a QR code the server prints; it needs a physical code to point at, so please type the values instead.)
4. Tap "Test Connection". It should report success and list the server's features. Then tap "Continue".
5. On "Health Access", tap "Grant Health Access". iOS shows its own permission sheet. Please tap "Turn On All" and Allow. The app requests READ access only — it never writes to Apple Health.
6. On "Data Types", a starter selection of about 14 types is already made. Tap "Continue".
7. On "Ready", tap "Start Syncing". The Dashboard appears and the initial upload begins.

WHAT YOU SHOULD SEE

- The Dashboard's "Samples exported" counter rises if the device has any Health data. A brand-new device may have none; that is expected, not a failure.
- To prove the round trip on an empty device: in Apple Health add a manual entry (Browse > Body Measurements > Weight > Add Data), return to PulsHealth and pull down on the Dashboard. The count rises within seconds.
- The Log tab shows every upload as it happens.

WHY WE DECLARE NSAllowsLocalNetworking

Self-hosted servers usually sit on the user's own network — a NAS, a home server, a Raspberry Pi — where a publicly trusted TLS certificate is impractical. The exception permits plain HTTP for local-network hosts ONLY. The app enforces the same rule itself, in ServerURLValidation: a URL is accepted only if it is https://, or http:// to localhost, a *.local name, an unqualified hostname, or a private IP range (10.x, 172.16-31.x, 192.168.x, 169.254.x). Plain http:// to any public host is refused, with an error, before it can be saved or tested. Everything else stays HTTPS-only; we do not set NSAllowsArbitraryLoads. The review server above is HTTPS, so this path is not involved in your test.

HEALTHKIT (Guideline 5.1.3)

- Read-only. The app requests HKObjectType read access and never calls any HealthKit write API. NSHealthUpdateUsageDescription states plainly: "PulsHealth does not write health data."
- Health data is not used for advertising, marketing, or data mining, and is not shared with any third party. The only recipient is the server the user configured.
- Health data is never written to iCloud. On the device it stays in the app's private container.

CAMERA

Used for one thing: reading the pairing QR code the server prints, so the user need not type a URL, a token and a UUID. No frame is stored or transmitted. Declining camera access is handled: the same screen offers a "Type It Instead" path and the app is fully usable without it.

BACKGROUND MODES

UIBackgroundModes "processing" plus HealthKit background delivery, so new samples upload without the user opening the app. Nothing else runs in the background. The app has no accounts, so there is no demo account to give you.

The app is open source (Apache-2.0): https://github.com/PulsHealth/pulshealth
Privacy policy: https://github.com/PulsHealth/pulshealth/blob/main/docs/privacy-policy.md
```

---

## Background for follow-up questions

### "Why does the app need an external server at all?"

It is a data-export tool. The point is that the user's health data ends up in a
database they control, so they can query it with SQL, chart it in Grafana, or
feed it to their own tools. Without a destination there is nothing to export
to. This is the same shape as other HealthKit exporters on the store; the
difference is that the destination here is the user's own machine rather than a
vendor's cloud, which is the feature, not a limitation.

### "The app is unusable without one — is that acceptable?"

The first-run flow is explicit about it. The welcome screen's third bullet says
"You need a server — a machine running the PulsHealth server (Docker, one
command). Without one there is nowhere to sync to." The App Store description
says the same thing in its third paragraph. A reviewer or a buyer learns it
before installing, and the review server removes the obstacle for review.

The flow also lets a user continue without a server ("I'll Set This Up Later"),
and the app then behaves like a picker with nothing to upload to — it does not
dead-end.

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
the Test Connection success row and the Dashboard counter moving. Do not use a
real person's health history.

### After approval

1. Take the review instance down (`docker compose down -v` in its directory).
2. Rotate `PULS_TOKEN` even so, in case the notes are cached anywhere.
3. Update `<<<REVIEW_EXPIRY>>>` here for the next submission rather than
   leaving a stale date.
