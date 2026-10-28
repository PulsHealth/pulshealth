export type SensorRecording = {
  label: string;
  seconds: number;
  km: number;
  meanHR: number | null;
  points: { seconds: number; value: number }[];
};
export type SensorReport = {
  sharedRuns: number;
  recordings: SensorRecording[];
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
  return {
    sharedRuns: data.sharedRuns,
    recordings: data.recordings.map((recording: SensorRecording, i: number) => {
      if (
        !recording ||
        !Number.isFinite(recording.seconds) ||
        recording.seconds <= 0 ||
        recording.seconds > 86400 ||
        !Number.isFinite(recording.km) ||
        recording.km < 0 ||
        (recording.meanHR !== null &&
          (!Number.isFinite(recording.meanHR) || recording.meanHR < 0)) ||
        !Array.isArray(recording.points) ||
        recording.points.length < 2 ||
        recording.points.length > 10000
      )
        throw new Error(
          "Check recording duration, distance and points (2–10,000 per recording).",
        );
      let previous = -1;
      const points = recording.points.map((point) => {
        if (
          !point ||
          !Number.isFinite(point.seconds) ||
          point.seconds < 0 ||
          point.seconds > recording.seconds ||
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
      return {
        label: ["Apple Watch", "Bluetooth sensor"][i],
        seconds: recording.seconds,
        km: recording.km,
        meanHR: recording.meanHR,
        points,
      };
    }),
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
