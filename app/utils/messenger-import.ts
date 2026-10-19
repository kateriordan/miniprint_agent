/**
 * Reads Messenger exports in the browser. Zip archives are streamed and only
 * message JSON entries are decompressed, so photos and videos are never read
 * or uploaded — only text and attachment metadata leave this device.
 */
import { Unzip, UnzipInflate } from "fflate";
import { isCandidateExportPath, mergeConversations, parseExportFile } from "#shared/messenger/parse";
import type { ParsedConversation } from "#shared/messenger/parse";

const MAX_JSON_BYTES = 50 * 1024 * 1024;

async function readZipJson(file: File, onEntry: (path: string, text: string) => void, warnings: string[]) {
  const decoder = new TextDecoder();
  const pending: Promise<void>[] = [];
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (entry) => {
    if (!isCandidateExportPath(entry.name)) {
      return;
    }
    if (entry.originalSize && entry.originalSize > MAX_JSON_BYTES) {
      warnings.push(`${entry.name}: larger than 50 MB, skipped.`);
      return;
    }
    const chunks: Uint8Array[] = [];
    pending.push(new Promise((resolve) => {
      entry.ondata = (err, data, final) => {
        if (err) {
          warnings.push(`${entry.name}: ${err.message}`);
          resolve();
          return;
        }
        chunks.push(data);
        if (final) {
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const buf = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            buf.set(c, off);
            off += c.length;
          }
          onEntry(entry.name, decoder.decode(buf));
          resolve();
        }
      };
      entry.start();
    }));
  };

  const reader = file.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      unzip.push(new Uint8Array(0), true);
      break;
    }
    unzip.push(value);
  }
  await Promise.all(pending);
}

export interface ParsedExport {
  conversations: ParsedConversation[];
  warnings: string[];
  filesRead: number;
}

export async function parseExportFiles(files: File[]): Promise<ParsedExport> {
  const warnings: string[] = [];
  const parts: ParsedConversation[] = [];
  let filesRead = 0;

  const handle = (path: string, text: string) => {
    try {
      const parsed = parseExportFile(path, JSON.parse(text), warnings);
      if (parsed) {
        parts.push(parsed);
        filesRead++;
      }
    }
    catch {
      warnings.push(`${path}: not valid JSON, skipped.`);
    }
  };

  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      await readZipJson(file, handle, warnings);
    }
    else if (file.name.toLowerCase().endsWith(".json")) {
      if (file.size > MAX_JSON_BYTES) {
        warnings.push(`${file.name}: larger than 50 MB, skipped.`);
        continue;
      }
      // Use the folder path when the browser provides it (directory picker).
      handle((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, await file.text());
    }
    else if (file.name.toLowerCase().endsWith(".html")) {
      warnings.push(`${file.name}: HTML exports are not supported — request the export in JSON format.`);
    }
  }

  return { conversations: mergeConversations(parts), warnings, filesRead };
}

/** Owner-name suggestions: names present in (nearly) every conversation. */
export function suggestOwnerNames(conversations: ParsedConversation[]): string[] {
  if (conversations.length === 0) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const c of conversations) {
    for (const p of new Set(c.participants)) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= Math.max(1, Math.ceil(conversations.length * 0.8)))
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 3);
}

/** Wire format: adds each message's ordinal among identical events, then splits large threads. */
export function toUploadChunks(conversations: ParsedConversation[], maxMessages = 1500, maxBytes = 2_000_000) {
  const pieces = conversations.flatMap((c) => {
    const seen = new Map<string, number>();
    const messages = c.messages.map((m) => {
      const key = [m.senderName, m.timestampMs, m.text ?? "", m.attachments.map(a => a.uri ?? a.link ?? a.type).join("|")].join("\u0000");
      const ordinal = seen.get(key) ?? 0;
      seen.set(key, ordinal + 1);
      return { ...m, text: m.text && m.text.length > 20_000 ? m.text.slice(0, 20_000) : m.text, ordinal };
    });
    const out = [];
    for (let i = 0; i < Math.max(messages.length, 1); i += maxMessages) {
      out.push({ ...c, messages: messages.slice(i, i + maxMessages) });
    }
    return out;
  });

  const chunks: Array<typeof pieces> = [];
  let current: typeof pieces = [];
  let size = 0;
  for (const p of pieces) {
    const s = JSON.stringify(p).length;
    if (current.length > 0 && (size + s > maxBytes || current.length >= 50)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += s;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
