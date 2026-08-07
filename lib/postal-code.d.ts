export function normalizePostalLookupAddress(value: string): string;
export function lookupTaiwanPostalCode(
  address: string,
  options?: {
    endpoint?: string;
    fetchImpl?: typeof fetch;
    minIntervalMs?: number;
    timeoutMs?: number;
  },
): Promise<string>;
