/**
 * 股東同意書 content, modelled on the official 經濟部 template (t70130).
 *
 * The form itself is one table of 申請事項 / 同意內容 rows followed by a
 * signature block, and the same sheet serves every filing: 設立 uses a single
 * row, while 變更登記 combines several (改選董事、遷址、增資…). The catalogue
 * below therefore keeps one entry per 申請事項 with the wording taken from the
 * template's 填寫範例, so adding 變更登記 later means selecting more entries
 * rather than writing a second document generator.
 */

const listNames = (names) =>
  names.map((name) => String(name ?? "").trim()).filter(Boolean).join("、");

const blank = "＿＿＿＿＿＿";

export const consentTopics = [
  {
    key: "incorporation",
    filing: "setup",
    subject: "公司設立",
    body: ({ company, directors }) =>
      `茲同意設立${company || blank}，訂定公司章程，並選任${
        listNames(directors ?? []) || blank
      }為董事。`,
  },
  {
    key: "articles_amendment",
    filing: "change",
    subject: "修正公司章程",
    body: () => "茲同意修改公司章程如所附章程修正條文對照表。",
  },
  {
    key: "director_appointment",
    filing: "change",
    subject: "董事、董事長選任",
    body: ({ directors, chairman }) =>
      `茲同意改推${listNames(directors ?? []) || blank}為董事，${
        chairman || blank
      }為董事長，對外代表本公司。`,
  },
  {
    key: "address_change",
    filing: "change",
    subject: "公司所在地變更",
    body: ({ registrationAddress }) =>
      `茲同意本公司所在地遷至${
        registrationAddress || blank
      }，並同意修正公司章程如所附章程修正條文對照表。`,
  },
  {
    key: "name_change",
    filing: "change",
    subject: "公司名稱變更",
    body: ({ company }) =>
      `茲同意本公司更名為${
        company || blank
      }，並同意修正公司章程如所附章程修正條文對照表。`,
  },
  {
    key: "business_change",
    filing: "change",
    subject: "公司所營事業變更",
    body: () =>
      "茲同意公司所營事業變更，並同意修正公司章程如所附章程修正條文對照表。",
  },
  {
    key: "capital_increase",
    filing: "change",
    subject: "增資",
    body: ({ capital, contributions }) =>
      `茲同意本公司增資新臺幣${capital || blank}元，${
        (contributions ?? [])
          .map(
            (item) =>
              `由${item.name || blank}出資新臺幣${item.capital || blank}元`,
          )
          .join("、") || blank
      }。`,
  },
];

export function consentTopicsFor(filing) {
  return consentTopics.filter((topic) => topic.filing === filing);
}

export function findConsentTopic(key) {
  return consentTopics.find((topic) => topic.key === key) ?? null;
}

/**
 * Builds the rows and signature lines for one 股東同意書.
 *
 * `shareholders` drives the signature block, which is why the count has to stay
 * open: a 有限公司 may be registered by one person or by a dozen, and every one
 * of them signs the same sheet.
 */
export function buildShareholderConsent(context) {
  const topicKeys = context.topicKeys?.length
    ? context.topicKeys
    : ["incorporation"];
  const rows = topicKeys
    .map((key) => findConsentTopic(key))
    .filter(Boolean)
    .map((topic) => ({ subject: topic.subject, body: topic.body(context) }));
  const shareholders = (context.shareholders ?? []).filter((item) =>
    String(item?.name ?? "").trim(),
  );
  return {
    title: `${context.company || blank}股東同意書`,
    rows,
    shareholders: shareholders.map((item) => ({
      name: String(item.name).trim(),
      nationalId: String(item.nationalId ?? "").trim(),
      capital: String(item.capital ?? "").trim(),
    })),
  };
}
