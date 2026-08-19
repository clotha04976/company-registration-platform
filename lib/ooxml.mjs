import { zipSync } from "fflate";

const encoder = new TextEncoder();
const xml = (value) => encoder.encode(value);

export const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );

const paragraph = (text, options = {}) => {
  const { bold = false, align = "left", size = 28, after = 120 } = options;
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="DFKai-SB" w:hAnsi="DFKai-SB" w:eastAsia="標楷體"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${bold ? "<w:b/>" : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
};

export function createDocxParts(title, lines) {
  const now = new Date().toISOString();
  const body = [
    paragraph(title, { bold: true, align: "center", size: 36, after: 360 }),
    ...lines.map((line) => paragraph(line)),
  ].join("");
  return {
    "[Content_Types].xml": xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    ),
    "_rels/.rels": xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    ),
    "word/document.xml": xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ),
    "word/styles.xml": xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DFKai-SB" w:hAnsi="DFKai-SB" w:eastAsia="標楷體"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`,
    ),
    "word/_rels/document.xml.rels": xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "docProps/core.xml": xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>公司設立登記智慧精靈</dc:creator><cp:lastModifiedBy>公司設立登記智慧精靈</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    ),
    "docProps/app.xml": xml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><AppVersion>16.0000</AppVersion></Properties>`,
    ),
  };
}

export function buildDocx(title, lines) {
  return zipSync(createDocxParts(title, lines), { level: 6 });
}

const formRun = (text, bold = false) =>
  `<w:r><w:rPr><w:rFonts w:ascii="DFKai-SB" w:hAnsi="DFKai-SB" w:eastAsia="標楷體"/><w:sz w:val="24"/>${bold ? "<w:b/>" : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const formParagraph = (text, bold = false, align = "left") =>
  `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="80"/></w:pPr>${String(
    text,
  )
    .split("\n")
    .map(
      (line, index) =>
        `${index ? "<w:r><w:br/></w:r>" : ""}${formRun(line, bold)}`,
    )
    .join("")}</w:p>`;
const formCell = (text, width, bold = false) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>${formParagraph(text, bold)}</w:tc>`;
const formTable = (rows, widths = [2600, 6760], rowHeights = []) =>
  `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/><w:insideH w:val="single" w:sz="6"/><w:insideV w:val="single" w:sz="6"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows.map((row, rowIndex) => `<w:tr>${rowHeights[rowIndex] ? `<w:trPr><w:trHeight w:val="${rowHeights[rowIndex]}" w:hRule="atLeast"/></w:trPr>` : ""}${row.map((value, index) => formCell(value, widths[index], index === 0)).join("")}</w:tr>`).join("")}</w:tbl>`;

export function buildRegistrationFormDocx(data) {
  // A 有限公司 may be registered by one person or by several, so the roster is
  // driven by the shareholder list and only falls back to the representative
  // when no list was collected.
  const people = data.shareholders?.length
    ? data.shareholders
    : [
        {
          role: "董事",
          name: data.representative,
          nationalId: data.nationalId,
          capital: data.capital,
        },
      ];
  const directorCount = people.filter((item) => item.role === "董事").length;
  const pageOne = [
    ["公司預查編號", data.precheck],
    ["公司統一編號", ""],
    ["公司聯絡電話", data.contactPhone || ""],
    ["投資及公司類型", "僑外投資事業 □　陸資 □　一人公司 □"],
    ["公司名稱", data.company],
    [
      "公司所在地",
      `${data.registrationPostalCode || ""}${data.registrationAddress}`,
    ],
    ["資本總額", `新臺幣 ${data.capital} 元`],
    ["董事人數", `${directorCount || 1} 人`],
    ["代表人姓名", data.representative],
    ["公司章程訂定日期", "民國　　年　　月　　日"],
    [
      "資本明細",
      people
        .map((item) => `${item.name}　新臺幣 ${item.capital || ""} 元`)
        .join("\n"),
    ],
    ["擬合併公司資料明細", ""],
    ["核准登記日期文號", ""],
    ["檔號", ""],
    ["公務記載蓋章欄", "　　　　　　　　　　　　　　　　"],
  ];
  const businessRows = [
    ["編號", "代碼", "營業項目說明"],
    ...data.business.map((item, index) => {
      const match = item.match(/^(\S+)\s+(.+)$/);
      return [String(index + 1), match?.[1] ?? "", match?.[2] ?? item];
    }),
  ];
  const peopleRows = [
    [
      "編號",
      "職稱",
      "姓名(或法人名稱)",
      "身分證號(或法人統一編號)",
      "出資額(元)",
    ],
    ...people.map((item, index) => [
      String(index + 1),
      item.role || "股東",
      item.name || "",
      item.nationalId || "",
      item.capital || "",
    ]),
  ];
  const sealTable = formTable(
    [
      [
        "公司印章",
        "　　　　　　　　　",
        "代表公司負責人印章",
        "　　　　　　　　　",
      ],
    ],
    [1500, 3100, 2100, 2660],
    [1600],
  );
  const pageOneHeights = pageOne.map((_, index) =>
    index === pageOne.length - 1 ? 1400 : 0,
  );
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${formParagraph("有限公司設立登記表", true, "center")}${sealTable}${formTable(pageOne, [2600, 6760], pageOneHeights)}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${formParagraph("有限公司設立登記表（第二頁）", true, "center")}${formParagraph("所營事業", true)}${formTable(businessRows, [900, 1900, 6560])}${formParagraph("董事、股東名單", true)}${formTable(peopleRows, [700, 1200, 2100, 2860, 2500])}${formTable([["(郵遞區號)住所或居所(或法人所在地)", `${data.contactPostalCode || ""}${data.contactAddress}`]], [3600, 5760])}${formTable([["公務記載蓋章欄", "　　　　　　　　　　　　　　　　　　　　　　　　　"]], [2600, 6760], [1400])}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>`;
  const parts = createDocxParts("有限公司設立登記表", []);
  parts["word/document.xml"] = xml(documentXml);
  return zipSync(parts, { level: 6 });
}

/**
 * Renders the 股東同意書 as the official template lays it out: a 申請事項 /
 * 同意內容 table, a tall cell for the company seal, one signature row per
 * shareholder and the 民國 date line.
 *
 * The signature rows are left blank on purpose. Every shareholder has to sign
 * in person, so printing their names into the cell would invite someone to file
 * a sheet nobody actually signed.
 */
export function buildShareholderConsentDocx(consent) {
  const rows = consent.rows.length
    ? consent.rows
    : [{ subject: "", body: "" }];
  const consentTable = formTable(
    [["申請事項", "同意內容"], ...rows.map((row) => [row.subject, row.body])],
    [2600, 6760],
    [0, ...rows.map(() => 900)],
  );
  const sealTable = formTable(
    [["(加蓋公司印章)", "　"]],
    [2600, 6760],
    [1700],
  );
  const shareholders = consent.shareholders.length
    ? consent.shareholders
    : [{ name: "", nationalId: "", capital: "" }];
  const signatureRows = [
    ["股東姓名", "身分證字號", "出資額(元)", "親自簽名"],
    ...shareholders.map((item) => [
      item.name,
      item.nationalId,
      item.capital,
      "　",
    ]),
  ];
  const signatureTable = formTable(
    signatureRows,
    [2000, 2400, 1900, 3060],
    [0, ...shareholders.map(() => 800)],
  );
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${formParagraph(consent.title, true, "center")}${consentTable}${sealTable}${signatureTable}${formParagraph("中　　華　　民　　國　　　　年　　　　月　　　　日", false, "center")}${formParagraph("提醒：日期為存入資本額日期，請先留空。", false, "left")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1100" w:right="900" w:bottom="1100" w:left="900"/></w:sectPr></w:body></w:document>`;
  const parts = createDocxParts(consent.title, []);
  parts["word/document.xml"] = xml(documentXml);
  return zipSync(parts, { level: 6 });
}

export function buildZip(entries) {
  const used = new Set();
  const files = {};
  for (const { name, data } of entries) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let uniqueName = name;
    let suffix = 2;
    while (used.has(uniqueName)) uniqueName = `${base}_${suffix++}${extension}`;
    used.add(uniqueName);
    files[uniqueName] = data;
  }
  return zipSync(files, { level: 6 });
}
