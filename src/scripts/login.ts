import { BEES_CONFIG } from "../config/bees.js";
import { createPersistentBrowser } from "../services/browser.js";

async function main() {
  console.log("Abrindo navegador...");

  const context = await createPersistentBrowser(false);

  const pages = context.pages();

  const page =
    pages.length > 0
      ? pages[0]
      : await context.newPage();

  console.log("Abrindo BEES...");

  await page.goto(BEES_CONFIG.portalUrl, {
    waitUntil: "domcontentloaded",
  });

  console.log("");
  console.log("======================================");
  console.log("REALIZE O LOGIN MANUALMENTE");
  console.log("======================================");
  console.log("");
  console.log("Após entrar na tela de rotas,");
  console.log("volte ao terminal e pressione ENTER.");
  console.log("");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  console.log("Salvando sessão...");

  await context.close();

  console.log("");
  console.log("Sessão persistente salva.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});