import { BEES_CONFIG } from "../config/bees.js";
import { TourStorage } from "../services/storage.js";
import { resolveDate } from "../services/sync-cli.js";

try {
  const date = process.argv[2];
  const scope = date ? { date: resolveDate(date), distributionCenterId: BEES_CONFIG.distributionCenterId } : undefined;
  const storage = new TourStorage();
  try {
    console.log(`${storage.removeFinalized(scope)} rota(s) POST_ROUTE/FINISHED/CLOSED removida(s), incluindo detalhes e histórico.`);
  } finally {
    storage.close();
  }
} catch (error) {
  console.error("Falha na remoção:", error);
  process.exitCode = 1;
}
