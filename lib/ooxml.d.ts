export function escapeXml(value: string): string;
export function createDocxParts(title: string, lines: string[]): Record<string, Uint8Array>;
export function buildDocx(title: string, lines: string[]): Uint8Array;
export function buildZip(entries: { name: string; data: Uint8Array }[]): Uint8Array;
