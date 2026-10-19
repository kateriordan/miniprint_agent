/** Trade statuses. Terminal and commitment statuses need owner confirmation. */
export const TRADE_STATUSES = [
  "new_offer",
  "needs_clarification",
  "under_review",
  "counteroffer",
  "accepted",
  "completed",
  "declined",
  "cancelled",
  "expired",
  "unknown",
] as const;
export type TradeStatus = typeof TRADE_STATUSES[number];

/**
 * Statuses that AI message analysis may set directly. Anything else it detects
 * (accepted, completed, declined, cancelled, expired) is recorded as a
 * proposed status for the owner to confirm.
 */
export const AI_SETTABLE_STATUSES = [
  "new_offer",
  "needs_clarification",
  "under_review",
  "counteroffer",
  "unknown",
] as const satisfies readonly TradeStatus[];

export const OWNER_CONFIRMED_STATUSES = [
  "accepted",
  "completed",
  "declined",
  "cancelled",
  "expired",
] as const satisfies readonly TradeStatus[];

export const OPEN_STATUSES: readonly TradeStatus[] = [
  "new_offer",
  "needs_clarification",
  "under_review",
  "counteroffer",
  "accepted",
  "unknown",
];

export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  new_offer: "New offer",
  needs_clarification: "Needs clarification",
  under_review: "Under review",
  counteroffer: "Counteroffer",
  accepted: "Accepted",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  unknown: "Unknown",
};

export type CatalogMatchStatus = "verified" | "candidate" | "ambiguous" | "unmatched";

/** One print on one side of a trade. */
export interface TradeLine {
  /** How the print was referred to in the messages. */
  label: string;
  /** Catalog print, only when the match is unambiguous. */
  printId: string | null;
  /** Possible catalog matches when the label is fuzzy or ambiguous. */
  candidatePrintIds: string[];
  matchStatus: CatalogMatchStatus;
  /** Null when the messages do not state a quantity. */
  quantity: number | null;
}

export interface AttachmentMeta {
  type: "photo" | "video" | "audio" | "file" | "gif" | "sticker" | "share" | "other";
  uri?: string;
  name?: string;
  link?: string;
}

export type EvidenceCategory =
  | "verified_catalog_fact"
  | "stated_preference"
  | "message_fact"
  | "ai_interpretation"
  | "unknown";

export type RecommendationAction = "accept" | "negotiate" | "decline" | "request_clarification";

export interface TradeRecommendation {
  action: RecommendationAction;
  summary: string;
  evaluationId: string;
  generatedAt: string;
  /** Always `ai_recommendation` — never a decision. */
  kind: "ai_recommendation";
}

export interface EvaluatedPrint {
  side: "requested_from_owner" | "offered_to_owner";
  label: string;
  quantity: number | null;
  printId: string | null;
  matchStatus: CatalogMatchStatus;
  candidatePrintIds: string[];
  catalog: null | {
    printId: string;
    canonicalName: string;
    artist: string;
    rarity: string | null;
    circulationStatus: string;
    catalogUrl: string;
    verifiedAt: string | null;
    verificationStatus: string;
  };
  /** For prints the owner would give: what the documented inventory shows. */
  inventory?: {
    documented: boolean;
    quantity: number | null;
    availability: string | null;
    committedElsewhere: Array<{ tradeId: string; status: string }>;
  };
}

export interface EvidenceItem {
  category: EvidenceCategory;
  statement: string;
  refs: Array<{ type: "message" | "catalog_record" | "inventory_item" | "trade" | "preference"; id: string; url?: string }>;
}

export interface EvaluationFacts {
  prints: EvaluatedPrint[];
  evidence: EvidenceItem[];
  uncertainties: string[];
  missingInformation: string[];
  sideSummary: {
    requestedFromOwner: { count: number | null; rarities: Record<string, number>; outOfCirculation: number };
    offeredToOwner: { count: number | null; rarities: Record<string, number>; outOfCirculation: number };
  };
  collectorHistory: {
    priorTrades: Array<{ tradeId: string; status: string; lastUpdatedAt: string }>;
    statedPreferences: Array<{ kind: string; quote: string; messageId: string }>;
  };
  catalogCheckedAt: string;
}

export const MESSAGE_SOURCES = ["fb_dyi_json", "fb_e2ee_json", "manual_entry"] as const;
export type MessageSource = typeof MESSAGE_SOURCES[number];

export const MESSAGE_SOURCE_LABELS: Record<MessageSource, string> = {
  fb_dyi_json: "Facebook “Export your information” (JSON)",
  fb_e2ee_json: "Messenger secure storage download (end-to-end encrypted chats)",
  manual_entry: "Manually entered message",
};
