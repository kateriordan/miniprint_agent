import type { TradeLine, TradeStatus } from "#shared/miniprint/types";
import { TRADE_STATUS_LABELS } from "#shared/miniprint/types";

export interface CatalogFact {
  printId: string;
  canonicalName: string;
  artist: string;
  rarity: string | null;
  circulationStatus: string;
  catalogUrl: string;
  imageUrl: string | null;
  collection: string | null;
  verifiedAt: string | null;
  verificationStatus: string;
}

export type CatalogMap = Record<string, CatalogFact>;

export function statusLabel(status: string) {
  return TRADE_STATUS_LABELS[status as TradeStatus] ?? status;
}

export function statusColor(status: string) {
  switch (status) {
    case "new_offer":
    case "counteroffer":
      return "info" as const;
    case "accepted":
    case "completed":
      return "success" as const;
    case "needs_clarification":
    case "under_review":
      return "warning" as const;
    case "declined":
    case "cancelled":
    case "expired":
      return "neutral" as const;
    default:
      return "neutral" as const;
  }
}

export function recommendationLabel(action: string) {
  return ({
    accept: "Accept",
    negotiate: "Negotiate",
    decline: "Decline",
    request_clarification: "Request clarification",
  } as Record<string, string>)[action] ?? action;
}

export function lineText(line: TradeLine) {
  return `${line.quantity ? `${line.quantity}× ` : ""}${line.label}`;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function errorMessage(error: unknown) {
  const e = error as { data?: { statusMessage?: string; message?: string }; statusMessage?: string; message?: string };
  return e?.data?.statusMessage ?? e?.data?.message ?? e?.statusMessage ?? e?.message ?? "Something went wrong";
}
