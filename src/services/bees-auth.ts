import type { Page } from "playwright";

export interface BeesAuth {
  authorization: string;
  country: string;
}

export async function captureBeesAuth(
  page: Page,
): Promise<BeesAuth> {
  console.log("Aguardando autenticação BEES...");

  const request = await page.waitForRequest(
    (request) => {
      const url = request.url();

      return (
        url.includes("services.bees-platform.com") &&
        Boolean(request.headers()["authorization"])
      );
    },
    {
      timeout: 30_000,
    },
  );

  const headers = request.headers();

  const authorization = headers["authorization"];

  if (!authorization) {
    throw new Error(
      "A requisição BEES não contém Authorization.",
    );
  }

  console.log("Autenticação encontrada.");

  return {
    authorization,
    country: headers["country"] ?? "BR",
  };
}