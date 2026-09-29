import { BEES_CONFIG } from "../config/bees.js";
import { createPersistentBrowser } from "./browser.js";
import { captureBeesAuth } from "./bees-auth.js";
import { getToursSummaries } from "./tours.js";
import { getTourDetails } from "./tour-details.js";
import { TourStorage, databasePath } from "./storage.js";
import { synchronizeTours } from "./sync-tours.js";

export function resolveDate(value?: string): string {
  const date = value ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: BEES_CONFIG.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error("Data inválida. Use YYYY-MM-DD.");
  }
  return date;
}

export async function runSync(dateInput?: string, tourInput?: string, headless = false) {
  const scope = { date: resolveDate(dateInput), distributionCenterId: BEES_CONFIG.distributionCenterId };
  const storage = new TourStorage();
  try {
    const context = await createPersistentBrowser(headless);
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const [auth] = await Promise.all([
        captureBeesAuth(page),
        page.goto(BEES_CONFIG.portalUrl, { waitUntil: "domcontentloaded" }),
      ]);
      const response = await getToursSummaries({ request: context.request, authorization: auth.authorization, date: scope.date });
      if (!Array.isArray(response.content)) throw new Error("Resposta de tours sem content válido.");
      let summaries = response.content;
      if (tourInput) {
        const byId = summaries.find((tour) => tour.id === tourInput);
        const matches = byId ? [byId] : summaries.filter((tour) => tour.displayId === tourInput);
        if (matches.length !== 1) throw new Error(`Rota "${tourInput}" ausente ou ambígua para ${scope.date}. Use o ID completo.`);
        summaries = matches;
      }
      const result = await synchronizeTours(storage, scope, summaries,
        (tourId) => getTourDetails({ request: context.request, authorization: auth.authorization, tourId }),
        tourInput ? summaries[0].id : undefined);
      console.log(`SQLite: ${databasePath()}`);
      console.log(`Data: ${scope.date} | Consultadas: ${result.total} | Atualizadas: ${result.updated} | Sem alterações: ${result.unchanged}`);
      for (const tour of result.changes) {
        console.log(`[${tour.displayId}] ${tour.changes.map((change) => change.field).join(", ")}`);
      }
      if (result.failures.length) {
        for (const failure of result.failures) console.error(`[${failure.tourId}] ${failure.error}`);
        throw new Error(`${result.failures.length} rota(s) não foram atualizadas; execute novamente para tentar de novo.`);
      }
      return result;
    } finally {
      await context.close();
    }
  } finally {
    storage.close();
  }
}
