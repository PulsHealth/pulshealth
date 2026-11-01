export type SensorRecording = {
  label: string;
  seconds: number;
  km: number;
  meanHR: number | null;
  points: { seconds: number; value: number }[];
  path?: string;
  routeMatch?: {
    coveragePercent: number;
    p95Feet: number;
    thresholdFeet: number;
  };
};
export type MonitorProfile = {
  name: string;
  connection?: string;
  position?: string;
  sensing?: string;
  description?: string;
  sourceUrl?: string;
};
export type SensorReport = {
  sharedRuns: number;
  recordings: SensorRecording[];
  watchRuns?: SensorRecording[];
  monitor?: MonitorProfile;
};
export function parseSensorReport(text: string): SensorReport {
  const data = JSON.parse(text);
  if (
    !data ||
    !Number.isInteger(data.sharedRuns) ||
    data.sharedRuns < 0 ||
    !Array.isArray(data.recordings) ||
    data.recordings.length !== 2
  )
    throw new Error(
      "Use two recordings and a source-audited sharedRuns count.",
    );
  function recording(input: SensorRecording, label: string): SensorRecording {
    if (
      !input ||
      !Number.isFinite(input.seconds) ||
      input.seconds <= 0 ||
      input.seconds > 86400 ||
      !Number.isFinite(input.km) ||
      input.km < 0 ||
      (input.meanHR !== null &&
        (!Number.isFinite(input.meanHR) || input.meanHR < 0)) ||
      !Array.isArray(input.points) ||
      input.points.length < 2 ||
      input.points.length > 10000
    )
      throw new Error(
        "Check recording duration, distance and points (2–10,000 per recording).",
      );
    let previous = -1;
    const points = input.points.map((point) => {
      if (
        !point ||
        !Number.isFinite(point.seconds) ||
        point.seconds < 0 ||
        point.seconds > input.seconds ||
        point.seconds <= previous ||
        !Number.isFinite(point.value) ||
        point.value < 0 ||
        point.value > 1000
      )
        throw new Error(
          "Points need increasing elapsed seconds and finite heart rates.",
        );
      previous = point.seconds;
      return { seconds: point.seconds, value: point.value };
    });
    if (
      input.path !== undefined &&
      (typeof input.path !== "string" ||
        input.path.length > 200000 ||
        !/^[ML\d,.\s-]+$/.test(input.path))
    )
      throw new Error("Use a normalized M/L SVG route path.");
    if (input.routeMatch !== undefined) {
      const match = input.routeMatch;
      if (
        !match ||
        !Number.isFinite(match.coveragePercent) ||
        match.coveragePercent < 0 ||
        match.coveragePercent > 100 ||
        !Number.isFinite(match.p95Feet) ||
        match.p95Feet < 0 ||
        !Number.isFinite(match.thresholdFeet) ||
        match.thresholdFeet <= 0
      )
        throw new Error("Check route-match measurements.");
    }
    return {
      label,
      seconds: input.seconds,
      km: input.km,
      meanHR: input.meanHR,
      points,
      ...(input.path ? { path: input.path } : {}),
      ...(input.routeMatch
        ? {
            routeMatch: {
              coveragePercent: input.routeMatch.coveragePercent,
              p95Feet: input.routeMatch.p95Feet,
              thresholdFeet: input.routeMatch.thresholdFeet,
            },
          }
        : {}),
    };
  }
  let watchRuns: SensorRecording[] | undefined,
    monitor: MonitorProfile | undefined;
  if (data.watchRuns !== undefined) {
    if (
      !Array.isArray(data.watchRuns) ||
      !data.watchRuns.length ||
      data.watchRuns.length > 12
    )
      throw new Error("Use 1–12 Watch comparisons.");
    watchRuns = data.watchRuns.map((run: SensorRecording) =>
      recording(run, "Apple Watch"),
    );
  }
  if (data.monitor !== undefined) {
    if (
      !data.monitor ||
      typeof data.monitor !== "object" ||
      typeof data.monitor.name !== "string" ||
      !data.monitor.name.trim() ||
      data.monitor.name.length > 80
    )
      throw new Error("Use a monitor model name up to 80 characters.");
    monitor = { name: data.monitor.name };
    for (const key of [
      "connection",
      "position",
      "sensing",
      "description",
      "sourceUrl",
    ] as const) {
      const value = data.monitor[key];
      if (value !== undefined) {
        if (typeof value !== "string" || value.length > 300)
          throw new Error("Monitor profile fields must be short text.");
        if (key === "sourceUrl" && !/^https:\/\//.test(value))
          throw new Error("Monitor reference must use HTTPS.");
        monitor[key] = value;
      }
    }
  }
  return {
    sharedRuns: data.sharedRuns,
    recordings: data.recordings.map((run: SensorRecording, i: number) =>
      recording(run, ["Apple Watch", "Bluetooth sensor"][i]),
    ),
    ...(watchRuns ? { watchRuns } : {}),
    ...(monitor ? { monitor } : {}),
  };
}
export function samplingStats(recording: SensorRecording) {
  const gaps = recording.points
    .slice(1)
    .map((point, i) => point.seconds - recording.points[i].seconds)
    .sort((a, b) => a - b);
  const quantile = (fraction: number) => {
    const p = (gaps.length - 1) * fraction,
      lo = Math.floor(p),
      t = p - lo;
    return gaps[lo] * (1 - t) + gaps[Math.ceil(p)] * t;
  };
  return {
    count: recording.points.length,
    median: quantile(0.5),
    p95: quantile(0.95),
    longest: gaps[gaps.length - 1],
    over10: gaps.filter((gap) => gap > 10).length,
    nearCoincident: gaps.filter((gap) => gap < 0.01).length,
    perMinute: recording.points.length / (recording.seconds / 60),
    buckets: [1, 2, 5, 10, 30, Infinity].map(
      (end, i) =>
        gaps.filter((gap) => gap >= [0, 1, 2, 5, 10, 30][i] && gap < end)
          .length,
    ),
  };
}
export function minuteCounts(
  recording: SensorRecording,
  end = recording.seconds,
) {
  const counts = Array.from({ length: Math.ceil(end / 60) }, () => 0);
  for (const point of recording.points)
    counts[Math.min(counts.length - 1, Math.floor(point.seconds / 60))]++;
  return counts;
}
