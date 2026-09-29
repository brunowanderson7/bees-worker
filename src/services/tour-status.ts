export const FINALIZED_STATUSES = ["POST_ROUTE", "FINISHED", "CLOSED"] as const;

export function isFinalizedStatus(status: string): boolean {
  return FINALIZED_STATUSES.some((value) => value === status.trim().toUpperCase());
}
