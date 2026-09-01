import { readFileSync, writeFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const templatePath = new URL("../templates/purchase-proof-template.docx", import.meta.url);
const files = unzipSync(readFileSync(templatePath));
let documentXml = strFromU8(files["word/document.xml"]);
const runPattern = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const runs = [];
let match;
while ((match = runPattern.exec(documentXml))) {
  runs.push({ start: match.index, end: runPattern.lastIndex, xml: match[0] });
}

const edits = [];
for (let index = 0; index < runs.length; index += 1) {
  if (!/w:fldCharType="begin"/.test(runs[index].xml)) continue;
  let separateIndex = -1;
  let endIndex = -1;
  for (let candidate = index + 1; candidate < runs.length; candidate += 1) {
    if (separateIndex < 0 && /w:fldCharType="separate"/.test(runs[candidate].xml)) separateIndex = candidate;
    if (/w:fldCharType="end"/.test(runs[candidate].xml)) {
      endIndex = candidate;
      break;
    }
  }
  if (separateIndex < 0 || endIndex < 0) continue;
  for (let candidate = separateIndex + 1; candidate < endIndex; candidate += 1) {
    const replacement = runs[candidate].xml.replace(
      /(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/g,
      "$1$2",
    );
    if (replacement !== runs[candidate].xml) edits.push({ ...runs[candidate], replacement });
  }
  index = endIndex;
}
for (const edit of edits.sort((left, right) => right.start - left.start)) {
  documentXml = `${documentXml.slice(0, edit.start)}${edit.replacement}${documentXml.slice(edit.end)}`;
}
files["word/document.xml"] = strToU8(documentXml);

for (const name of Object.keys(files)) {
  if (name.startsWith("customXml/")) delete files[name];
}
if (files["[Content_Types].xml"]) {
  files["[Content_Types].xml"] = strToU8(
    strFromU8(files["[Content_Types].xml"]).replace(
      /<Override\b[^>]*PartName="\/customXml\/[^"]+"[^>]*\/>/g,
      "",
    ),
  );
}
if (files["word/_rels/document.xml.rels"]) {
  files["word/_rels/document.xml.rels"] = strToU8(
    strFromU8(files["word/_rels/document.xml.rels"]).replace(
      /<Relationship\b[^>]*(?:Type="[^"]*\/customXml"|Target="\.\.\/customXml\/[^"]+")[^>]*\/>/g,
      "",
    ),
  );
}

let identityIds = 0;
let emails = 0;
let customReferences = 0;
for (const [name, bytes] of Object.entries(files)) {
  if (!/\.(?:xml|rels)$/i.test(name)) continue;
  const text = strFromU8(bytes);
  identityIds += (text.match(/\b[A-Z][12]\d{8}\b/g) || []).length;
  emails += (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).length;
  customReferences += (text.match(/customXml/g) || []).length;
}
if (identityIds || emails || customReferences) {
  throw new Error("購票證明範本仍含有不應保留的隱藏資料");
}

const output = zipSync(files, { level: 6 });
writeFileSync(templatePath, output);
console.log(JSON.stringify({ bytes: output.length, fieldResultRunsScrubbed: edits.length }));
