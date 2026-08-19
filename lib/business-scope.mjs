import { categories, items } from "./business-items.mjs";

export const businessCategories = categories;

export const businessItems = items.map(([code, name, category]) => ({
  code,
  name,
  category,
  categoryName: categories[category] ?? "",
}));

const byCode = new Map(businessItems.map((item) => [item.code, item]));

export function findBusinessItem(code) {
  return byCode.get(String(code ?? "").trim().toUpperCase()) ?? null;
}

/**
 * Splits a stored entry such as `E801010 室內裝潢業` back into its parts.
 *
 * Entries also arrive from the pre-check OCR, where the code may be missing or
 * misread, so anything that does not start with a well-formed code is kept
 * whole as the description rather than being silently discarded.
 */
export function parseBusinessItem(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^([A-Z]{1,2}\d{5,6})\s*(.*)$/i);
  if (!match) return { code: "", name: text };
  const code = match[1].toUpperCase();
  return { code, name: match[2].trim() || findBusinessItem(code)?.name || "" };
}

export function formatBusinessItem(item) {
  const code = String(item?.code ?? "").trim();
  const name = String(item?.name ?? "").trim();
  return [code, name].filter(Boolean).join(" ");
}

const normalize = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");

/**
 * Ranks the catalogue against a free-text query.
 *
 * With 788 items a plain substring filter returns far too many rows to scan, so
 * matches are ordered by how specific they are: an exact code, then a code
 * prefix, then the label from its start, and only then a match anywhere inside
 * the label.
 */
export function searchBusinessItems(query, limit = 20) {
  const needle = normalize(query);
  if (!needle) return businessItems.slice(0, limit);
  const scored = [];
  for (const item of businessItems) {
    const code = item.code;
    const name = item.name;
    let score = -1;
    if (code === needle) score = 0;
    else if (code.startsWith(needle)) score = 1;
    else if (name.startsWith(needle)) score = 2;
    else if (code.includes(needle)) score = 3;
    else if (name.includes(needle)) score = 4;
    else if (item.categoryName.includes(needle)) score = 5;
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort(
    (left, right) =>
      left.score - right.score || left.item.code.localeCompare(right.item.code),
  );
  return scored.slice(0, limit).map((entry) => entry.item);
}
