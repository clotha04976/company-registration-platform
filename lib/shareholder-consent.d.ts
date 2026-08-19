export type ConsentFiling = "setup" | "change";
export type ConsentShareholder = { name: string; nationalId?: string; capital?: string };
export type ConsentContext = {
  company?: string;
  directors?: string[];
  chairman?: string;
  capital?: string;
  registrationAddress?: string;
  contributions?: { name: string; capital: string }[];
  shareholders?: ConsentShareholder[];
  topicKeys?: string[];
};
export type ConsentTopic = {
  key: string;
  filing: ConsentFiling;
  subject: string;
  body: (context: ConsentContext) => string;
};
export const consentTopics: ConsentTopic[];
export function consentTopicsFor(filing: ConsentFiling): ConsentTopic[];
export function findConsentTopic(key: string): ConsentTopic | null;
export function buildShareholderConsent(context: ConsentContext): {
  title: string;
  rows: { subject: string; body: string }[];
  shareholders: { name: string; nationalId: string; capital: string }[];
};
