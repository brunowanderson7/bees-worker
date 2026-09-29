import { runSync } from "../services/sync-cli.js";

// Analysis compares the live summaries against SQLite and refreshes changed details.
runSync(process.argv[2]).catch((error) => {
  console.error("Falha na análise e atualização:", error);
  process.exitCode = 1;
});
