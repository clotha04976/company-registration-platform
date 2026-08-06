export type PrecheckBusinessItem = {
  code: string;
  name: string;
};

export type ParsedPrecheck = {
  precheckNumber: string;
  approvalDate: string;
  expiryDate: string;
  companyName: string;
  businessItems: PrecheckBusinessItem[];
};

export function normalizePrecheckNumber(value: string): string;
export function isValidPrecheckNumber(value: string): boolean;
export function normalizeRocDate(value: string): string;
export function parsePrecheckText(
  pagesOrText: string | { text?: string }[],
): ParsedPrecheck;
