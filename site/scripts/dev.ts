import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { syncBlogImages } from "./blog-images";
import { refreshBlog } from "./blog-reload";

syncBlogImages({ includeDrafts: true });
refreshBlog();
const child = spawn(process.execPath, ["run", "next", "dev", ...process.argv.slice(2)], { stdio: "inherit" });
const blogDir = path.resolve("../blog");
let pending: ReturnType<typeof setTimeout> | undefined;
const watcher = fs.watch(blogDir, { recursive: true }, () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    try {
      syncBlogImages({ includeDrafts: true });
      refreshBlog();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }, 150);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", code => {
  watcher.close();
  clearTimeout(pending);
  process.exit(code ?? 0);
});
child.on("error", error => {
  watcher.close();
  console.error(error);
  process.exit(1);
});
