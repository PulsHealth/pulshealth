"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface HeartRateDataPoint {
  time: string;
  bpm: number;
}

interface HeartRateChartProps {
  title?: string;
  description?: string;
  data?: HeartRateDataPoint[];
  showZones?: boolean;
  height?: number;
}

// Sample daily heart rate pattern showing realistic variation
const defaultData: HeartRateDataPoint[] = [
  { time: "6 AM", bpm: 58 },
  { time: "7 AM", bpm: 62 },
  { time: "8 AM", bpm: 72 },
  { time: "9 AM", bpm: 78 },
  { time: "10 AM", bpm: 85 },
  { time: "11 AM", bpm: 92 },
  { time: "12 PM", bpm: 88 },
  { time: "1 PM", bpm: 75 },
  { time: "2 PM", bpm: 82 },
  { time: "3 PM", bpm: 78 },
  { time: "4 PM", bpm: 95 },
  { time: "5 PM", bpm: 110 },
  { time: "6 PM", bpm: 125 },
  { time: "7 PM", bpm: 98 },
  { time: "8 PM", bpm: 82 },
  { time: "9 PM", bpm: 72 },
  { time: "10 PM", bpm: 65 },
  { time: "11 PM", bpm: 60 },
];

// Heart rate zones (approximate for average adult)
const heartRateZones = [
  { value: 60, label: "Resting", color: "#22c55e" },
  { value: 100, label: "Fat Burn", color: "#eab308" },
  { value: 140, label: "Cardio", color: "#f97316" },
  { value: 170, label: "Peak", color: "#ef4444" },
];

export function HeartRateChart({
  title = "Heart Rate Over Time",
  description,
  data = defaultData,
  showZones = false,
  height = 300,
}: HeartRateChartProps) {
  return (
    <Card className="my-6 not-prose">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={data}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-muted"
              opacity={0.5}
            />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[40, 180]}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border bg-background p-3 shadow-md">
                      <p className="text-sm font-medium">
                        {payload[0].payload.time}
                      </p>
                      <p className="text-2xl font-bold text-brand">
                        {payload[0].value}{" "}
                        <span className="text-sm font-normal text-muted-foreground">
                          BPM
                        </span>
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            {showZones &&
              heartRateZones.map((zone) => (
                <ReferenceLine
                  key={zone.label}
                  y={zone.value}
                  stroke={zone.color}
                  strokeDasharray="5 5"
                  strokeOpacity={0.7}
                  label={{
                    value: zone.label,
                    position: "right",
                    fill: zone.color,
                    fontSize: 11,
                  }}
                />
              ))}
            <Line
              type="monotone"
              dataKey="bpm"
              stroke="#0092FF"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 6,
                fill: "#0092FF",
                stroke: "#fff",
                strokeWidth: 2,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
        {showZones && (
          <div className="mt-4 flex flex-wrap gap-4 justify-center text-xs text-muted-foreground">
            {heartRateZones.map((zone) => (
              <div key={zone.label} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: zone.color }}
                />
                <span>
                  {zone.label} ({zone.value}+ BPM)
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
