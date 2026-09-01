export type TaxBureauJurisdiction = {
  code: string;
  name: string;
  shortName: string;
  counties: readonly string[];
};

export type InferredTaxJurisdiction = {
  bureauCode: string;
  bureauName: string;
  bureauShortName: string;
  county: string;
  branchName: string;
  branchCandidates: string[];
  needsBranchConfirmation: boolean;
};

export const taxBureauJurisdictions: readonly TaxBureauJurisdiction[];
export const purchaseProofTaxOffices: readonly {
  bureauCode: string;
  county: string;
  officeName: string;
  districts: readonly string[];
  boundary: string;
}[];
export function normalizeTaiwanAddress(value: unknown): string;
export function inferTaxBureau(address: unknown): Omit<InferredTaxJurisdiction, "branchName" | "branchCandidates" | "needsBranchConfirmation"> | null;
export function inferTaxJurisdiction(address: unknown): InferredTaxJurisdiction | null;
export function purchaseProofOfficeOptions(bureauNameOrCode?: string): string[];
