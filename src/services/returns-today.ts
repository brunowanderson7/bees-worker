import { BEES_CONFIG } from "../config/bees.js";
import { TourStorage } from "./storage.js";
import { collectReturns } from "./returns.js";
import { resolveDate } from "./sync-cli.js";
import { createPersistentBrowser } from "./browser.js";
import { captureBeesAuth } from "./bees-auth.js";
import { getToursSummaries } from "./tours.js";
import { getTourDetails } from "./tour-details.js";
import { synchronizeTours } from "./sync-tours.js";

export async function getReturnsToday({ offline = true, headless = true } = {}) {
  const date = resolveDate();
  const distributionCenterId = BEES_CONFIG.distributionCenterId;
  const statuses = (process.env.BEES_RETURN_STATUSES ?? "DEFINITELY_RETURNED").split(",").map((s) => s.trim()).filter(Boolean);
  if (!statuses.length) throw new Error("BEES_RETURN_STATUSES não pode estar vazio.");
  const storage = new TourStorage();
  const failures: { tourId: string; error: string }[] = [];
  try {
    if (!offline) {
      const context = await createPersistentBrowser(headless);
      try {
        const page = context.pages()[0] ?? await context.newPage();
        const [auth] = await Promise.all([captureBeesAuth(page),
          page.goto(BEES_CONFIG.portalUrl, { waitUntil: "domcontentloaded" })]);
        const response = await getToursSummaries({ request: context.request, authorization: auth.authorization, date });
        if (!Array.isArray(response.content)) throw new Error("Resposta de tours sem content válido.");
        const candidates = new Map(storage.listLatest(distributionCenterId)
          .map((tour) => [tour.summary.id, { scope: tour.scope, summary: tour.summary }]));
        for (const summary of response.content) candidates.set(summary.id, { scope: { date, distributionCenterId }, summary });
        for (const { scope, summary } of candidates.values()) {
          const result = await synchronizeTours(storage, scope, [summary],
            (tourId) => getTourDetails({ request: context.request, authorization: auth.authorization, tourId }), summary.id);
          failures.push(...result.failures);
        }
      } finally { await context.close(); }
    }
    const failed = new Set(failures.map((failure) => failure.tourId));
    const tours = storage.listLatest(distributionCenterId);
    const report = collectReturns(tours.filter((tour) => !failed.has(tour.summary.id)), {
      date, timezone: BEES_CONFIG.timezone, distributionCenterId, statuses,
    });
    const complete = report.metadata.complete && !failures.length;
    return { ...report,
      metadata: { ...report.metadata, source: offline ? "sqlite" : "bees", complete }, failures,
    };

  } finally { storage.close(); }
}


