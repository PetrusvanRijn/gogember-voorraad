import "server-only";

import { BlobNotFoundError, get, put } from "@vercel/blob";
import { HISTORY_VERSION, type HistoryStore } from "./history";

const PATHNAME = "gogember/daily-usage-v1.json";

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export async function readHistoryStore(): Promise<HistoryStore | null> {
  try {
    const result = await get(PATHNAME, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text) as HistoryStore;
    if (parsed.version !== HISTORY_VERSION || !parsed.days) return null;
    return parsed;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
}

export async function writeHistoryStore(store: HistoryStore): Promise<void> {
  await put(PATHNAME, JSON.stringify(store), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}
