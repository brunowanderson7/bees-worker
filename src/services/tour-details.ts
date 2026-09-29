import { randomUUID } from "node:crypto";

import type {
  APIRequestContext,
} from "playwright";

import { BEES_CONFIG } from "../config/bees.js";

import type {
  BeesTourDetailsResponse,
} from "../types/tour-details.js";

interface GetTourDetailsParams {
  request: APIRequestContext;
  authorization: string;
  tourId: string;
}

export async function getTourDetails({
  request,
  authorization,
  tourId,
}: GetTourDetailsParams): Promise<BeesTourDetailsResponse> {
  const url = new URL(
    `/api/tour-business-service/v1/tours-details/${tourId}`,
    BEES_CONFIG.apiBaseUrl,
  );

  const requestTraceId = randomUUID();

  console.log(`GET ${url.toString()}`);
  console.log(`requestTraceId: ${requestTraceId}`);

  const response = await request.get(
    url.toString(),
    {
      headers: {
        accept:
          "application/json, text/plain, */*",

        authorization,

        country:
          BEES_CONFIG.country,

        requestTraceId,

        referer:
          "https://deliver-portal.bees-platform.com/",
      },
    },
  );

  if (!response.ok()) {
    const body =
      await response.text();

    throw new Error(
      [
        `Erro BEES HTTP ${response.status()}`,
        `Tour ID: ${tourId}`,
        body,
      ].join("\n"),
    );
  }

  return response.json() as Promise<BeesTourDetailsResponse>;
}