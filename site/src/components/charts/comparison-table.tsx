"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Minus } from "lucide-react";

// Clinical ranges table - auto-styled for health data
interface ClinicalRange {
  population: string;
  normal?: string;
  low?: string;
  high?: string;
  values?: string; // Alternative: single string with all values
}

interface ClinicalRangesTableProps {
  title?: string;
  description?: string;
  ranges: ClinicalRange[];
  metric?: string;
  unit?: string;
}

export function ClinicalRangesTable({
  title = "Clinical Ranges",
  description,
  ranges,
  metric,
  unit,
}: ClinicalRangesTableProps) {
  // Determine if we're using the simple values format or structured format
  const hasStructuredData = ranges.some((r) => r.normal || r.low || r.high);

  return (
    <Card className="my-6 not-prose">
      <CardHeader>
        <CardTitle className="text-lg">
          {title}
          {metric && (
            <span className="text-muted-foreground font-normal ml-2">
              ({metric})
            </span>
          )}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Population</TableHead>
                {hasStructuredData ? (
                  <>
                    <TableHead className="text-red-600">Low</TableHead>
                    <TableHead className="text-green-600">Normal</TableHead>
                    <TableHead className="text-amber-600">High</TableHead>
                  </>
                ) : (
                  <TableHead>
                    Values{unit && <span className="font-normal"> ({unit})</span>}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranges.map((range, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{range.population}</TableCell>
                  {hasStructuredData ? (
                    <>
                      <TableCell className="text-red-600">{range.low || "—"}</TableCell>
                      <TableCell className="text-green-600 font-medium">
                        {range.normal || "—"}
                      </TableCell>
                      <TableCell className="text-amber-600">{range.high || "—"}</TableCell>
                    </>
                  ) : (
                    <TableCell>{range.values || "—"}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Device comparison table
interface DeviceComparison {
  device: string;
  accuracy?: string;
  features?: string[];
  notes?: string;
  rating?: number; // 1-5
}

interface DeviceComparisonTableProps {
  title?: string;
  description?: string;
  devices: DeviceComparison[];
  showRating?: boolean;
}

export function DeviceComparisonTable({
  title = "Device Comparison",
  description,
  devices,
  showRating = true,
}: DeviceComparisonTableProps) {
  const renderRating = (rating?: number) => {
    if (!rating) return "—";
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-2 w-2 rounded-full ${
              i <= rating ? "bg-brand" : "bg-muted"
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <Card className="my-6 not-prose">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Accuracy</TableHead>
                {showRating && <TableHead>Rating</TableHead>}
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{device.device}</TableCell>
                  <TableCell>{device.accuracy || "—"}</TableCell>
                  {showRating && <TableCell>{renderRating(device.rating)}</TableCell>}
                  <TableCell className="text-muted-foreground">
                    {device.notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Feature comparison table (for comparing capabilities)
interface FeatureRow {
  feature: string;
  [key: string]: string | boolean | undefined;
}

interface FeatureComparisonTableProps {
  title?: string;
  description?: string;
  columns: string[]; // Column headers (e.g., device names)
  features: FeatureRow[];
}

export function FeatureComparisonTable({
  title = "Feature Comparison",
  description,
  columns,
  features,
}: FeatureComparisonTableProps) {
  const renderCell = (value: string | boolean | undefined) => {
    if (value === true) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    }
    if (value === false) {
      return <XCircle className="h-5 w-5 text-red-400" />;
    }
    if (value === undefined || value === "") {
      return <Minus className="h-5 w-5 text-muted-foreground" />;
    }
    return <span>{value}</span>;
  };

  return (
    <Card className="my-6 not-prose">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                {columns.map((col) => (
                  <TableHead key={col} className="text-center">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{row.feature}</TableCell>
                  {columns.map((col) => (
                    <TableCell key={col} className="text-center">
                      {renderCell(row[col])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Simple data table for general use
interface DataTableProps {
  title?: string;
  description?: string;
  headers: string[];
  rows: (string | number)[][];
  highlightColumn?: number; // 0-indexed column to highlight
}

export function DataTable({
  title,
  description,
  headers,
  rows,
  highlightColumn,
}: DataTableProps) {
  return (
    <Card className="my-6 not-prose">
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={!title && !description ? "pt-6" : ""}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((header, i) => (
                  <TableHead
                    key={i}
                    className={highlightColumn === i ? "text-brand" : ""}
                  >
                    {header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell
                      key={cellIndex}
                      className={
                        highlightColumn === cellIndex
                          ? "text-brand font-medium"
                          : cellIndex === 0
                          ? "font-medium"
                          : ""
                      }
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Pros/Cons comparison
interface ProConItem {
  text: string;
}

interface ProConComparisonProps {
  title?: string;
  description?: string;
  pros: ProConItem[];
  cons: ProConItem[];
}

export function ProConComparison({
  title,
  description,
  pros,
  cons,
}: ProConComparisonProps) {
  return (
    <Card className="my-6 not-prose">
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={!title && !description ? "pt-6" : ""}>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold text-green-600 mb-3 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Pros
            </h4>
            <ul className="space-y-2">
              {pros.map((pro, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="text-green-600">+</span>
                  {pro.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-red-600 mb-3 flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Cons
            </h4>
            <ul className="space-y-2">
              {cons.map((con, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="text-red-600">−</span>
                  {con.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
