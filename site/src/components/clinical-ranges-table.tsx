import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Ruler } from "lucide-react";

interface ClinicalRange {
  population: string;
  notes?: string;
  [key: string]: string | undefined;
}

interface ClinicalRangesTableProps {
  ranges: ClinicalRange[];
}

export function ClinicalRangesTable({ ranges }: ClinicalRangesTableProps) {
  if (!ranges || ranges.length === 0) return null;

  // Check if there's any data key other than population/notes across all ranges
  const hasData = ranges.some((range) =>
    Object.keys(range).some(
      (key) => key !== "population" && key !== "notes" && range[key]
    )
  );

  if (!hasData) return null;

  // Get all unique keys across all ranges, excluding population and notes
  const dataKeys = Array.from(new Set(ranges.flatMap((r) => Object.keys(r))))
    .filter((key) => key !== "population" && key !== "notes");

  return (
    <section>
      <h2 className="text-2xl font-semibold mb-4 flex items-center">
        <Ruler className="mr-2 h-5 w-5 text-brand" />
        Clinical Ranges
      </h2>
      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[30%] font-semibold">
                Population
              </TableHead>
              {dataKeys.map((key) => (
                <TableHead key={key} className="capitalize font-semibold">
                  {key.replace(/_/g, " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranges.map((range, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{range.population}</TableCell>
                {dataKeys.map((key) => (
                  <TableCell key={key} className="text-sm">
                    {range[key] ? (
                      key === "normal" || key === "average" ? (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
                        >
                          {range[key]}
                        </Badge>
                      ) : (
                        range[key]
                      )
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
