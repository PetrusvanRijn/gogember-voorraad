import { PAGE_SIZE } from "./config";

export type Page<T> = {
  items: T[];
  /** Undefined when the payload does not say. A short page then ends the loop. */
  hasNext?: boolean;
  nextId: number | null;
};

export async function paginate<T extends { id?: number | null }>(
  fetchPage: (idGt: number) => Promise<Page<T>>,
  options?: { maxPages?: number; pageSize?: number },
): Promise<T[]> {
  const maxPages = options?.maxPages ?? 2000;
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  const byId = new Map<number, T>();
  const withoutId: T[] = [];
  // StockItUp rejects id_gt=0. The first page starts at 1; later pages use the last id.
  let idGt = 1;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(idGt);
    for (const item of result.items) {
      if (typeof item.id === "number") {
        if (byId.has(item.id)) byId.delete(item.id);
        byId.set(item.id, item);
      } else {
        withoutId.push(item);
      }
    }

    if (result.items.length === 0) break;
    if (result.hasNext === false) break;
    if (result.items.length < pageSize && result.hasNext !== true) break;

    const last = result.items[result.items.length - 1];
    const next = result.nextId ?? (typeof last?.id === "number" ? last.id : null);
    if (next == null || next <= idGt) break;
    idGt = next;
  }

  return [...byId.values(), ...withoutId];
}
