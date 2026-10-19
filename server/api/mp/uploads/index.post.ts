import { saveUpload } from "~~/server/utils/mp/inventory";
import { requireSessionUserId } from "~~/server/utils/session";

/** Accepts one or more photos as multipart form data (field name `photos`). */
export default defineEventHandler(async (event) => {
  const ownerId = await requireSessionUserId(event);
  const parts = await readMultipartFormData(event);
  const files = (parts ?? []).filter(p => p.name === "photos" && p.filename && p.data?.length);
  if (files.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No photos received." });
  }
  const results = [];
  for (const f of files.slice(0, 20)) {
    try {
      const { upload, duplicate } = await saveUpload(ownerId, { filename: f.filename!, mediaType: f.type ?? "", data: f.data });
      results.push({ filename: f.filename, id: upload.id, duplicate, error: null });
    }
    catch (error) {
      results.push({ filename: f.filename, id: null, duplicate: false, error: (error as { statusMessage?: string }).statusMessage ?? (error as Error).message });
    }
  }
  return { results };
});
