import { runSync } from "../services/sync-cli.js";

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Use: npm run sync:tour -- <id ou displayId> [YYYY-MM-DD]");
  await runSync(process.argv[3], input);
}
main().catch((error) => {
  console.error("Falha ao atualizar rota:", error);
  process.exitCode = 1;
});
