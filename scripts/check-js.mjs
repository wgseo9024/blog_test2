import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
const roots = ["functions", "scheduler-worker/src", "scripts", "test"];
const files = [];
const walk = (dir) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
  const target = path.join(dir, entry.name); if (entry.isDirectory()) walk(target); else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(target);
} };
for (const root of roots) { try { walk(root); } catch { /* optional directory */ } }
for (const file of files) { const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" }); if (result.status) process.exit(result.status); }
console.log(`JavaScript syntax checked: ${files.length} files`);
