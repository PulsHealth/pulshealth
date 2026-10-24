import { execFileSync } from "node:child_process";
import path from "node:path";

// A shallow checkout cannot establish when older content actually changed.
// Omit its dates rather than treating the build or shallow boundary as a revision.
export function contentModified(repoPaths: string[], root = path.resolve(process.cwd(), "..")): string | undefined {
  try {
    if (execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() !== "false") return undefined;
    if (execFileSync("git", ["status", "--porcelain", "--", ...repoPaths], { cwd: root, encoding: "utf8" }).trim()) return undefined;
    const value = execFileSync("git", ["log", "-1", "--format=%cI", "--", ...repoPaths], { cwd: root, encoding: "utf8" }).trim();
    return value && Number.isFinite(Date.parse(value)) ? value : undefined;
  } catch {
    return undefined;
  }
}
