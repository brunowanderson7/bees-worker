import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "playwright";

import { BEES_CONFIG } from "../config/bees.js";

import type {
  BeesToursSummariesResponse,
} from "../types/tours.js";

interface GetToursParams {
  request: APIRequestContext;
  authorization: string;
  date: string;
}

export async function getToursSummaries({
  request,
  authorization,
  date,
}: GetToursParams): Promise<BeesToursSummariesResponse> {
  const url = new URL(
    "/api/tour-business-service/v1/tours-summaries",
    BEES_CONFIG.apiBaseUrl,
  );

  url.searchParams.set("date", date);

  url.searchParams.set(
    "distributionCenterId",
    BEES_CONFIG.distributionCenterId,
  );

  const requestTraceId = randomUUID();

  console.log(`GET ${url.toString()}`);
  console.log(`requestTraceId: ${requestTraceId}`);

  const response = await request.get(url.toString(), {
    headers: {
      accept: "application/json, text/plain, */*",

      authorization,

      country: BEES_CONFIG.country,

      requestTraceId,

      referer: "https://deliver-portal.bees-platform.com/",
    },
  });

  if (!response.ok()) {
    const body = await response.text();

    throw new Error(
      [
        `Erro BEES HTTP ${response.status()}`,
        body,
      ].join("\n"),
    );
  }

  return response.json() as Promise<BeesToursSummariesResponse>;
}