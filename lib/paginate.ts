import { PAGE_SIZE } from "./config";

export type Page<T> = {
  items: T[];
  /** Undefined when the payload does not say. A short page then ends the loop. */
  hasNext?: boolean;
  nextId: number | null;
};

export type PaginateResult<T> = {
  items: T[];
  /** False when the page cap or the time budget stopped the scan early. */
  complete: boolean;
  /** Pass this back as startId to continue. */
  nextId: number;
};

export async function paginateDetailed<T extends { id?: number | null }>(
  fetchPage: (idGt: number) => Promise<Page<T>>,
  options?: { maxPages?: number; pageSize?: number; startId?: number; deadlineMs?: number },
): Promise<PaginateResult<T>> {
  const maxPages = options?.maxPages ?? 2000;
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  const deadline = options?.deadlineMs ?? Number.POSITIVE_INFINITY;
  const byId = new Map<number, T>();
  const withoutId: T[] = [];
  // StockItUp rejects id_gt=0. The first page starts at 1; later pages use the last id.
  let idGt = options?.startId && options.startId > 0 ? options.startId : 1;

  const items = () => [...byId.values(), ...withoutId];

  for (let page = 0; page < maxPages; page += 1) {
    if (Date.now() >= deadline) return { items: items(), complete: false, nextId: idGt };

    const result = await fetchPage(idGt);
    for (const item of result.items) {
      if (typeof item.id === "number") {
        if (byId.has(item.id)) byId.delete(item.id);
        byId.set(item.id, item);
      } else {
        withoutId.push(item);
      }
    }

    if (result.items.length === 0) return { items: items(), complete: true, nextId: idGt };
    if (result.hasNext === false) return { items: items(), complete: true, nextId: idGt };
    if (result.items.length < pageSize && result.hasNext !== true) return { items: items(), complete: true, nextId: idGt };

    const last = result.items[result.items.length - 1];
    const next = result.nextId ?? (typeof last?.id === "number" ? last.id : null);
    if (next == null || next <= idGt) return { items: items(), complete: true, nextId: idGt };
    idGt = next;
  }

  return { items: items(), complete: false, nextId: idGt };
}

export async function paginate<T extends { id?: number | null }>(
  fetchPage: (idGt: number) => Promise<Page<T>>,
  options?: { maxPages?: number; pageSize?: number; startId?: number; deadlineMs?: number },
): Promise<T[]> {
  const result = await paginateDetailed(fetchPage, options);
  return result.items;
}
