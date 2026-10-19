/**
 * Parsers for Messenger data the account owner downloads from Meta:
 *
 * - `fb_dyi_json`: Accounts Center → Export your information, JSON format.
 *   Threads live in `messages/<folder>/<thread>/message_N.json`.
 * - `fb_e2ee_json`: Messenger → Privacy & safety → End-to-end encrypted chats
 *   → Message storage → Download secure storage data.
 *
 * Runs in the browser and on the server, so media never has to leave the
 * owner's machine: only text and attachment metadata are kept.
 */
import type { AttachmentMeta, MessageSource } from "../miniprint/types";

export interface ParsedMessage {
  sourceMessageId: string | null;
  senderName: string;
  timestampMs: number;
  text: string | null;
  attachments: AttachmentMeta[];
  reactions: Array<{ actor: string; reaction: string }>;
  isUnsent: boolean;
}

export interface ParsedConversation {
  source: MessageSource;
  sourceKey: string;
  title: string | null;
  participants: string[];
  isGroup: boolean;
  /** Export folder (`inbox`, `archived_threads`, `message_requests`, …) when known. */
  folder: string | null;
  messages: ParsedMessage[];
}

export interface ParseResult {
  conversations: ParsedConversation[];
  warnings: string[];
}

/**
 * Facebook's JSON export writes UTF-8 bytes as individual `\u00XX` escapes,
 * so "é" arrives as "Ã©". Re-decode when every code unit fits in a byte.
 */
export function fixMojibake(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) {
    return value;
  }
  try {
    const bytes = Uint8Array.from(value, c => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  catch {
    return value;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" ? fixMojibake(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Path segments for a DYI thread: `[..., "messages", folder, thread, "message_1.json"]`. */
function dyiPathInfo(path: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  const idx = parts.lastIndexOf("messages");
  if (idx === -1 || parts.length < idx + 4) {
    return null;
  }
  return { folder: parts[idx + 1]!, thread: parts[idx + 2]! };
}

function dyiAttachments(m: Record<string, unknown>): AttachmentMeta[] {
  const out: AttachmentMeta[] = [];
  const add = (type: AttachmentMeta["type"], list: unknown) => {
    for (const item of asArray(list)) {
      if (isRecord(item)) {
        out.push({ type, uri: str(item.uri) ?? undefined });
      }
    }
  };
  add("photo", m.photos);
  add("video", m.videos);
  add("audio", m.audio_files);
  add("gif", m.gifs);
  for (const item of asArray(m.files)) {
    if (isRecord(item)) {
      const uri = str(item.uri) ?? undefined;
      out.push({ type: "file", uri, name: uri?.split("/").pop() });
    }
  }
  if (isRecord(m.sticker)) {
    out.push({ type: "sticker", uri: str(m.sticker.uri) ?? undefined });
  }
  if (isRecord(m.share)) {
    out.push({ type: "share", link: str(m.share.link) ?? undefined });
  }
  return out;
}

function reactionsOf(list: unknown): Array<{ actor: string; reaction: string }> {
  return asArray(list).flatMap((r) => {
    if (!isRecord(r)) {
      return [];
    }
    const actor = str(r.actor);
    const reaction = str(r.reaction);
    return actor && reaction ? [{ actor, reaction }] : [];
  });
}

function parseDyi(path: string, data: Record<string, unknown>, warnings: string[]): ParsedConversation | null {
  const info = dyiPathInfo(path);
  const threadPath = str(data.thread_path) ?? (info ? `${info.folder}/${info.thread}` : null);
  if (!threadPath) {
    warnings.push(`${path}: no thread_path and the file is not under messages/<folder>/<thread>/ — skipped.`);
    return null;
  }

  const participants = asArray(data.participants)
    .map(p => (isRecord(p) ? str(p.name) : null))
    .filter((n): n is string => !!n);

  const messages: ParsedMessage[] = [];
  let skipped = 0;
  for (const raw of asArray(data.messages)) {
    if (!isRecord(raw)) {
      skipped++;
      continue;
    }
    const sender = str(raw.sender_name);
    const ts = typeof raw.timestamp_ms === "number" ? raw.timestamp_ms : Number.NaN;
    if (!sender || !Number.isFinite(ts)) {
      skipped++;
      continue;
    }
    messages.push({
      sourceMessageId: null,
      senderName: sender,
      timestampMs: Math.trunc(ts),
      text: str(raw.content),
      attachments: dyiAttachments(raw),
      reactions: reactionsOf(raw.reactions),
      isUnsent: raw.is_unsent === true,
    });
  }
  if (skipped > 0) {
    warnings.push(`${path}: ${skipped} message entries were missing a sender or timestamp and were skipped.`);
  }

  // Thread folders are "<name>_<numeric id>"; the path is the stable thread key.
  const folder = info?.folder ?? threadPath.split("/")[0] ?? null;
  return {
    source: "fb_dyi_json",
    sourceKey: `fb_dyi:${threadPath.split("/").slice(-1)[0]}`,
    title: str(data.title),
    participants,
    isGroup: participants.length > 2,
    folder,
    messages,
  };
}

function parseE2ee(path: string, data: Record<string, unknown>, warnings: string[]): ParsedConversation | null {
  const participants = asArray(data.participants)
    .map(p => (typeof p === "string" ? fixMojibake(p) : isRecord(p) ? str(p.name) : null))
    .filter((n): n is string => !!n);
  const title = str(data.threadName) ?? str(data.title);

  const messages: ParsedMessage[] = [];
  let skipped = 0;
  for (const raw of asArray(data.messages)) {
    if (!isRecord(raw)) {
      skipped++;
      continue;
    }
    const sender = str(raw.senderName) ?? str(raw.sender_name);
    const tsRaw = raw.timestamp ?? raw.timestamp_ms;
    const ts = typeof tsRaw === "number" ? tsRaw : Number.NaN;
    if (!sender || !Number.isFinite(ts)) {
      skipped++;
      continue;
    }
    const media = asArray(raw.media).flatMap((m): AttachmentMeta[] =>
      isRecord(m) ? [{ type: "other", uri: str(m.uri) ?? undefined }] : []);
    messages.push({
      sourceMessageId: null,
      senderName: sender,
      // Seconds would land in 1970; treat small values as seconds.
      timestampMs: Math.trunc(ts < 1e11 ? ts * 1000 : ts),
      text: str(raw.text) ?? str(raw.content),
      attachments: media,
      reactions: reactionsOf(raw.reactions),
      isUnsent: raw.isUnsent === true || raw.is_unsent === true,
    });
  }
  if (skipped > 0) {
    warnings.push(`${path}: ${skipped} message entries were missing a sender or timestamp and were skipped.`);
  }

  const key = [title ?? "", ...[...participants].sort()].join("|");
  return {
    source: "fb_e2ee_json",
    sourceKey: `fb_e2ee:${key}`,
    title,
    participants,
    isGroup: participants.length > 2,
    folder: null,
    messages,
  };
}

/** Recognize and parse one JSON file from either export. Returns null for unrelated files. */
export function parseExportFile(path: string, json: unknown, warnings: string[]): ParsedConversation | null {
  if (!isRecord(json) || !Array.isArray(json.messages)) {
    return null;
  }
  const first = json.messages.find(isRecord);
  const looksE2ee = (first && ("senderName" in first || "timestamp" in first))
    || typeof json.threadName === "string"
    || (Array.isArray(json.participants) && typeof json.participants[0] === "string");
  if (looksE2ee) {
    return parseE2ee(path, json, warnings);
  }
  return parseDyi(path, json, warnings);
}

/** Merge the `message_N.json` parts of the same thread into one conversation. */
export function mergeConversations(parts: ParsedConversation[]): ParsedConversation[] {
  const byKey = new Map<string, ParsedConversation>();
  for (const part of parts) {
    const existing = byKey.get(part.sourceKey);
    if (!existing) {
      byKey.set(part.sourceKey, { ...part, messages: [...part.messages] });
      continue;
    }
    existing.messages.push(...part.messages);
    for (const name of part.participants) {
      if (!existing.participants.includes(name)) {
        existing.participants.push(name);
      }
    }
    existing.title ??= part.title;
  }
  for (const conversation of byKey.values()) {
    conversation.messages.sort((a, b) => a.timestampMs - b.timestampMs);
    conversation.isGroup = conversation.participants.length > 2;
  }
  return [...byKey.values()];
}

/** Paths in an export archive worth reading. Media is never read. */
export function isCandidateExportPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (!p.endsWith(".json") || p.includes("__MACOSX/")) {
    return false;
  }
  return /(^|\/)messages\/[^/]+\/[^/]+\/message_\d+\.json$/.test(p)
    || !/(^|\/)(photos|videos|audio|files|gifs|stickers_used)\//.test(p);
}
