export type ParsedIdentity = { name: string; nationalId: string; sourceFile?: string };
export function normalizeTaiwanNationalId(value: string): string;
export function isValidTaiwanNationalId(value: string): boolean;
export function isPlausibleTaiwanName(value: string): boolean;
export function parseTaiwanIdentityText(pagesOrText: string | { text?: string }[]): ParsedIdentity;
export function selectIdentityResult(orderedFileIds: string[], results: Record<string, ParsedIdentity>): ({ state: "processing" | "review" } | ({ state: "success" | "partial" } & ParsedIdentity));
export function mergeIdentityFields<T extends { representative: string; nationalId: string }>(current: T, parsed: Partial<ParsedIdentity> | undefined, manual: { representative: boolean; nationalId: boolean }): T;
