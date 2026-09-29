import { runSync } from "../services/sync-cli.js";

runSync(process.argv[2]).catch((error) => {
  console.error("Falha na sincronização:", error);
  process.exitCode = 1;
});
