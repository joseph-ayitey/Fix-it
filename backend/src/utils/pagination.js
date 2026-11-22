// Cursor pagination helpers (contract: components/schemas/PageInfo).
//
// A cursor is opaque to clients: base64url of { id, sort } of the last item on the page.
// The next page is "rows that sort after that row", looked up by id on the server, so
// pages stay correct even when rows are added in the meantime (unlike OFFSET).

import { badRequest } from "./errors.js";

export const DEFAULT_LIMIT = 20;

export function encodeCursor(id, sort) {
  return Buffer.from(JSON.stringify({ id, sort })).toString("base64url");
}

/** @returns {number|null} the id to continue after, or null for the first page */
export function decodeCursor(cursor, sort) {
  if (!cursor) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    parsed = null;
  }
  if (!parsed || !Number.isInteger(parsed.id) || parsed.id < 1 || parsed.sort !== sort) {
    throw badRequest("the cursor is invalid, or belongs to a different sort order. Start again without a cursor", [
      { field: "query.cursor", message: "is not a valid cursor for this list" },
    ]);
  }
  return parsed.id;
}

/** Given limit+1 fetched rows, the page: { items, page: { limit, nextCursor, hasMore } } */
export function toPage(rows, limit, sort, toItem) {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(toItem),
    page: { limit, nextCursor: hasMore ? encodeCursor(pageRows.at(-1).id, sort) : null, hasMore },
  };
}

/** For small, bounded lists (team, directory, offers): everything on one page. */
export function singlePage(items, limit = items.length || 1) {
  return { items, page: { limit, nextCursor: null, hasMore: false } };
}
