export type BusinessItem = { code: string; name: string; category: string; categoryName: string };
export const businessCategories: Record<string, string>;
export const businessItems: BusinessItem[];
export function findBusinessItem(code: string): BusinessItem | null;
export function parseBusinessItem(value: string): { code: string; name: string };
export function formatBusinessItem(item: { code?: string; name?: string }): string;
export function searchBusinessItems(query: string, limit?: number): BusinessItem[];
