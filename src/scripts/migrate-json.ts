import { TourStorage, databasePath } from "../services/storage.js";
import { migrateLegacyData } from "../services/migrate-legacy.js";

async function main() {
  const storage = new TourStorage();
  try {
    console.log(`${await migrateLegacyData(storage)} rota(s) importada(s) para ${databasePath()}.`);
  } finally {
    storage.close();
  }
}
main().catch((error) => {
  console.error("Falha na importação:", error);
  process.exitCode = 1;
});
