"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface DataPoint {
  [key: string]: string | number;
}

export interface ReferenceBand {
  y: number;
  label: string;
  color: string;
}

interface GenericChartProps {
  title?: string;
  description?: string;
  data: DataPoint[];
  type?: "line" | "bar" | "area";
  xKey: string;
  yKey: string;
  yLabel?: string;
  color?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  referenceLines?: ReferenceBand[];
  yDomain?: [number, number];
  gradientFill?: boolean;
}

export function GenericChart({
  title,
  description,
  data,
  type = "line",
  xKey,
  yKey,
  yLabel,
  color = "#0092FF",
  height = 300,
  showGrid = true,
  showLegend = false,
  referenceLines = [],
  yDomain,
  gradientFill = false,
}: GenericChartProps) {
  const gradientId = `gradient-${yKey}`;

  const renderChart = () => {
    const commonProps = {
      data,
      margin: { top: 10, right: 30, left: 0, bottom: 0 },
    };

    const commonAxisProps = {
      xAxis: (
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
          tickLine={false}
          axisLine={false}
        />
      ),
      yAxis: (
        <YAxis
          domain={yDomain || ["auto", "auto"]}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}`}
        />
      ),
      grid: showGrid && (
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-muted"
          opacity={0.5}
        />
      ),
      tooltip: (
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              return (
                <div className="rounded-lg border bg-background p-3 shadow-md">
                  <p className="text-sm font-medium">
                    {payload[0].payload[xKey]}
                  </p>
                  <p className="text-2xl font-bold text-brand">
                    {payload[0].value}{" "}
                    {yLabel && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {yLabel}
                      </span>
                    )}
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
      ),
      referenceLines: referenceLines.map((ref) => (
        <ReferenceLine
          key={ref.label}
          y={ref.y}
          stroke={ref.color}
          strokeDasharray="5 5"
          strokeOpacity={0.7}
          label={{
            value: ref.label,
            position: "right",
            fill: ref.color,
            fontSize: 11,
          }}
        />
      )),
      legend: showLegend && <Legend />,
    };

    const gradient = gradientFill && (
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.3} />
          <stop offset="95%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
    );

    switch (type) {
      case "bar":
        return (
          <BarChart {...commonProps}>
            {gradient}
            {commonAxisProps.grid}
            {commonAxisProps.xAxis}
            {commonAxisProps.yAxis}
            {commonAxisProps.tooltip}
            {commonAxisProps.referenceLines}
            {commonAxisProps.legend}
            <Bar
              dataKey={yKey}
              fill={color}
              radius={[4, 4, 0, 0]}
              opacity={0.9}
            />
          </BarChart>
        );

      case "area":
        return (
          <AreaChart {...commonProps}>
            {gradient}
            {commonAxisProps.grid}
            {commonAxisProps.xAxis}
            {commonAxisProps.yAxis}
            {commonAxisProps.tooltip}
            {commonAxisProps.referenceLines}
            {commonAxisProps.legend}
            <Area
              type="monotone"
              dataKey={yKey}
              stroke={color}
              strokeWidth={2}
              fill={gradientFill ? `url(#${gradientId})` : color}
              fillOpacity={gradientFill ? 1 : 0.3}
            />
          </AreaChart>
        );

      case "line":
      default:
        return (
          <LineChart {...commonProps}>
            {gradient}
            {commonAxisProps.grid}
            {commonAxisProps.xAxis}
            {commonAxisProps.yAxis}
            {commonAxisProps.tooltip}
            {commonAxisProps.referenceLines}
            {commonAxisProps.legend}
            <Line
              type="monotone"
              dataKey={yKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 6,
                fill: color,
                stroke: "#fff",
                strokeWidth: 2,
              }}
            />
          </LineChart>
        );
    }
  };

  return (
    <Card className="my-6 not-prose">
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={!title && !description ? "pt-6" : ""}>
        <ResponsiveContainer width="100%" height={height}>
          {renderChart()}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Multi-line chart for comparing multiple metrics
interface MultiLineChartProps {
  title?: string;
  description?: string;
  data: DataPoint[];
  xKey: string;
  lines: {
    key: string;
    label: string;
    color: string;
  }[];
  height?: number;
  showGrid?: boolean;
  yDomain?: [number, number];
}

export function MultiLineChart({
  title,
  description,
  data,
  xKey,
  lines,
  height = 300,
  showGrid = true,
  yDomain,
}: MultiLineChartProps) {
  return (
    <Card className="my-6 not-prose">
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={!title && !description ? "pt-6" : ""}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={data}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted"
                opacity={0.5}
              />
            )}
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={yDomain || ["auto", "auto"]}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border bg-background p-3 shadow-md">
                      <p className="text-sm font-medium mb-2">
                        {payload[0].payload[xKey]}
                      </p>
                      {payload.map((entry, index) => (
                        <p
                          key={index}
                          className="text-sm"
                          style={{ color: entry.color }}
                        >
                          {entry.name}: <span className="font-bold">{entry.value}</span>
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            {lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.label}
                stroke={line.color}
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 5,
                  fill: line.color,
                  stroke: "#fff",
                  strokeWidth: 2,
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-4 flex flex-wrap gap-4 justify-center text-xs text-muted-foreground">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: line.color }}
              />
              <span>{line.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
