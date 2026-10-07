/**
 * Ported from the repository README's FAQ, which is the source of truth; keep
 * the two in step when either changes. The support page renders all of it and
 * the home page a subset.
 */
export interface FaqItem {
  q: string;
  a: string;
  /** Show on the home page as well as the support page. */
  home?: boolean;
}

export const faq: FaqItem[] = [
  {
    q: "Is the app really free?",
    a: "Yes. There are no in-app purchases, and exploring and exporting need no account. The open-source stack is free to run yourself: one command on any Docker host. Or use the PulsHealth database, where we run the database, viewer and AI connection for you.",
    home: true,
  },
  {
    q: "Do I need a domain, a VPN or Tailscale?",
    a: "Not with the PulsHealth database: you connect the app to your account and that is all. For your own database, also no: on the same Wi-Fi the phone can sync to your database over plain HTTP; the app allows that for local-network addresses only. From anywhere else you need HTTPS, which means a TLS proxy or a VPN such as Tailscale in front of the ingest port.",
  },
  {
    q: "Where does my data go?",
    a: "To the one database you set up in the app, and nowhere else. If it is your own, the developer receives nothing. If it is the PulsHealth database, we store your data there under your account, use it only to show it back to you and to the assistants you connect, never sell or share it, and delete it when you delete your account. Exploring and exporting send nothing at all. The app has zero third-party dependencies and no analytics SDK.",
    home: true,
  },
  {
    q: "Which AI can I connect?",
    a: "Any AI agent that speaks MCP: PulsHealth ships an MCP server, so Claude, ChatGPT, Cursor, Qwen and other MCP clients can read your data. On the PulsHealth database, add it as a connector, sign in and allow access; on your own database, run the MCP server that ships with the stack. ChatGPT can also use the product API as a custom GPT Action. Either way the assistant can read your data and change nothing. The AI guide in the documentation has the steps for each client.",
    home: true,
  },
  {
    q: "Can I sync to a database I already have?",
    a: "Yes, through a receiver for the Puls Sync Protocol v1, the wire format the app speaks. It is specified with a JSON Schema per line type, a fixture corpus, a conformance checker and a complete receiver in one Python file. Anything that speaks it is a valid destination.",
  },
  {
    q: "How long does a first backfill take?",
    a: "It depends on the phone, not the database, because reading HealthKit is the slow part. The app includes a benchmark that reads real data without uploading it, so you can measure your own device first. Progress is saved after every confirmed batch, so you can interrupt it safely.",
  },
  {
    q: "How is it different from other Apple Health exporters?",
    a: "Three things together: the app and the database are both open source, the sync format is written down so anything can receive it, and the database can be hosted for you or run by you, with Claude connected either way. The About page compares it with Health Auto Export, HealthSave, FreeReps and Apple's own export.",
    home: true,
  },
  {
    q: "Does it write anything into Apple Health?",
    a: "No. The app requests read access only, and its usage strings say so.",
    home: true,
  },
  {
    q: "My Watch data arrives minutes or hours late.",
    a: "Watch to iPhone HealthKit transfer is scheduled by watchOS and cannot be forced by any app. Opening PulsHealth, or putting the Watch on its charger, usually prompts it. Once the data is on the phone it syncs normally.",
  },
  {
    q: "Steps, active energy and distance lag by up to an hour, while workouts appear in seconds.",
    a: "iOS throttles \"immediate\" background delivery for those high-frequency types to roughly hourly, without saying so, and it is not configurable. Anything else you record on the phone, and every foreground open, syncs right away.",
  },
  {
    q: "Nothing synced overnight.",
    a: "While the phone is locked, HealthKit is unreadable, and iOS prefers to run background processing when the device is idle, which is to say locked, overnight. PulsHealth detects this, records the wake as skipped (locked) on the Background Activity screen instead of claiming a sync, and catches up at the next unlock or app open.",
  },
  {
    q: "I swiped the app away and it stopped syncing.",
    a: "iOS does not wake force-quit apps for background delivery or scheduled tasks. Open the app again and it resumes; leaving it in the app switcher is enough.",
  },
  {
    q: "Blood pressure never shows up in the permission sheet.",
    a: "On iOS 26 the Health permission sheet silently omits blood pressure systolic and diastolic, so they can never be granted from within the app (Apple Feedback FB22735935; iOS 27 fixes it). Grant them yourself in Settings, Privacy & Security, Health, PulsHealth. The app shows a hint when it detects the situation and backfills the full history once access exists.",
  },
  {
    q: "Daily step totals in the database are higher than the Health app shows.",
    a: "The iPhone and the Watch both record steps, and a naive sum of raw samples counts both. Use the metric_daily view, or the app's on-device aggregate series, which HealthKit already de-duplicates, instead of summing quantity_samples. The database guide explains the query patterns.",
  },
];
