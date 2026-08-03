import { zipSync } from "fflate";

const encoder = new TextEncoder();
const xml = (value) => encoder.encode(value);

export const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[char]);

const paragraph = (text, options = {}) => {
  const { bold = false, align = "left", size = 28, after = 120 } = options;
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="DFKai-SB" w:hAnsi="DFKai-SB" w:eastAsia="標楷體"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${bold ? "<w:b/>" : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
};

export function createDocxParts(title, lines) {
  const now = new Date().toISOString();
  const body = [paragraph(title, { bold: true, align: "center", size: 36, after: 360 }), ...lines.map((line) => paragraph(line))].join("");
  return {
    "[Content_Types].xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "word/document.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    "word/styles.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="DFKai-SB" w:hAnsi="DFKai-SB" w:eastAsia="標楷體"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`),
    "word/_rels/document.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "docProps/core.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>公司設立登記智慧精靈</dc:creator><cp:lastModifiedBy>公司設立登記智慧精靈</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    "docProps/app.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><AppVersion>16.0000</AppVersion></Properties>`),
  };
}

export function buildDocx(title, lines) {
  return zipSync(createDocxParts(title, lines), { level: 6 });
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
