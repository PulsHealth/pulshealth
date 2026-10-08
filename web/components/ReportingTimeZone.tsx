export function ReportingTimeZone({ timeZone }: { timeZone: string }) {
  const zones = [...new Set(["UTC", timeZone, ...Intl.supportedValuesOf("timeZone")])].sort();
  return (
    <section className="rise" style={{ marginTop: 28 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Reporting time zone</div>
      <form method="post" action="/api/auth/time-zone" className="panel" style={{ padding: 20, maxWidth: 560 }}>
        <div className="form-field">
          <label htmlFor="reporting-time-zone">Time zone</label>
          <input id="reporting-time-zone" name="time_zone" list="reporting-time-zones" defaultValue={timeZone} required maxLength={100} />
          <datalist id="reporting-time-zones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
          <span className="form-hint">New hosted accounts start with the first uploading iPhone&apos;s time zone. Traveling does not change this setting. Raw readings are grouped and displayed in this zone; daily phone aggregates and activity rings keep their recorded phone calendar dates.</span>
        </div>
        <button type="submit" className="btn btn-primary">Save time zone</button>
      </form>
    </section>
  );
}
