export const BEES_CONFIG = {
  portalUrl: "https://deliver-portal.bees-platform.com/routes",

  apiBaseUrl: "https://services.bees-platform.com",

  distributionCenterId: process.env.BEES_DISTRIBUTION_CENTER_ID ?? "0730882",

  country: process.env.BEES_COUNTRY ?? "BR",

  timezone: process.env.BEES_TIMEZONE ?? "America/Fortaleza",
} as const;
