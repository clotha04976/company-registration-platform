export type IdentityUploadSide = "auto" | "front" | "back" | "combined";
export type IdentityServiceResult = {
  status: "success" | "review";
  model: string;
  name: string;
  nationalId: string;
  nationalIdSource: "ocr" | "barcode" | "";
  birthDate: string;
  address: string;
  confidence: number;
  detectedCards: number;
  warnings: string[];
  durationMs: number;
};
export function recognizeIdentityWithService(file: File, side?: IdentityUploadSide, options?: { baseUrl?: string; fetchImpl?: typeof fetch }): Promise<IdentityServiceResult>;
