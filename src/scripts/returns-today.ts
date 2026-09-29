import { getReturnsToday } from "../services/returns-today.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--offline")) throw new Error("Use: npm run returns:today -- [--offline]");
  const report = await getReturnsToday({ offline: args.includes("--offline"), headless: false });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.metadata.complete) process.exitCode = 1;
}

// Keep stdout machine-readable; API/browser progress logs go to stderr.
console.log = (...args: unknown[]) => console.error(...args);
main().catch((error) => {
  process.stdout.write(JSON.stringify({ metadata: { complete: false }, content: [],
    error: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
});
