import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  clearSmallCheckboxShapes,
  detachMailMergeSettings,
  emptySettingsRelationships,
  extractVisibleText,
  insertBeforeVisibleLabel,
  materializeFieldsXml,
  removeTrailingPageBreak,
  replaceAllVisibleText,
  replaceBetweenVisible,
  replaceCellTextXml,
  replaceVisibleRegex,
  sectionPropertyFromElements,
  setAllTextBlackXml,
  setInlineCheckbox,
  setParagraphCheckbox,
  splitTopLevelBody,
  splitTopLevelFragment,
  textNodes,
} from './lib/purchase-proof-xml.mjs';

const rootDir = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_OFFICE_VALUES = Object.freeze({
  generic: {
    names: ['{{OFFICE_NAME}}'],
    unifiedNumbers: ['{{OFFICE_UNIFIED_NUMBER}}'],
    responsiblePeople: ['{{OFFICE_RESPONSIBLE_PERSON}}'],
    responsiblePersonIds: ['{{OFFICE_RESPONSIBLE_PERSON_ID}}'],
    addresses: ['{{OFFICE_ADDRESS}}'],
    phones: ['{{OFFICE_PHONE}}'],
    compactPhones: ['{{OFFICE_PHONE_COMPACT}}'],
    mediaCodes: ['{{OFFICE_MEDIA_CODE}}'],
    licenseNumbers: ['{{OFFICE_LICENSE_NUMBER}}'],
  },
});

const PAGE_TITLES = Object.freeze([
  '領用統一發票購票證申請書',
  '營業人委任代理委任書',
  '集中購買統一發票申請書',
  '委任專業代理人查詢下載電子發票相關業務申請書',
]);

function templatePath() {
  return join(rootDir, 'templates', 'purchase-proof-template.docx');
}

function chineseNumber(value) {
  const number = Number(value);
  const digits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (!Number.isFinite(number)) return '';
  if (number < 10) return digits[number];
  if (number < 20) return `十${number === 10 ? '' : digits[number - 10]}`;
  if (number < 100) return `${digits[Math.floor(number / 10)]}十${number % 10 ? digits[number % 10] : ''}`;
  return String(number).split('').map((digit) => digits[Number(digit)]).join('');
}

function formatChineseApplicationDate(date) {
  const year = String(date.year || '').split('').map((digit) => chineseNumber(digit)).join('');
  const month = date.month ? chineseNumber(date.month) : '　';
  const day = date.day ? chineseNumber(date.day) : '　';
  return `中華民國${year}年${month}月${day}日`;
}

function splitDocumentPages(documentXml) {
  const body = splitTopLevelBody(documentXml);
  const finalSectionIndex = body.elements.findLastIndex((element) => /^<w:sectPr\b/.test(element));
  if (finalSectionIndex < 0) throw new Error('Word 範本缺少最終 w:sectPr');
  const finalSection = body.elements[finalSectionIndex];
  const content = body.elements.filter((_element, index) => index !== finalSectionIndex);
  const starts = PAGE_TITLES.map((title) => content.findIndex((element) => (
    extractVisibleText(element).includes(title)
  )));
  if (starts.some((index) => index < 0) || !starts.every((value, index) => index === 0 || value > starts[index - 1])) {
    throw new Error(`無法辨識 Word 範本四頁邊界：${starts.join(',')}`);
  }
  const pages = starts.map((start, index) => content.slice(start, starts[index + 1] ?? content.length));
  return { ...body, finalSection, pages };
}

function assembleSelectedPages(parts, selectedPages, transformedPages) {
  const selected = [...selectedPages].sort((left, right) => left - right);
  const lastPageNumber = selected[selected.length - 1];
  let finalSection = parts.finalSection;
  const output = [];

  for (const pageNumber of selected) {
    let elements = transformedPages[pageNumber - 1];
    if (pageNumber === lastPageNumber && pageNumber <= 2) {
      const extracted = sectionPropertyFromElements(elements);
      elements = extracted.elements;
      if (!extracted.section) throw new Error(`第 ${pageNumber} 頁缺少分節設定`);
      finalSection = extracted.section;
    }
    if (pageNumber === lastPageNumber && pageNumber === 3) {
      elements = removeTrailingPageBreak(elements);
    }
    output.push(...elements);
  }

  return `${parts.prefix}${output.join('')}${finalSection}${parts.suffix}`
    .replace(/<w:lastRenderedPageBreak\s*\/>/g, '');
}

function boolAt(source, pathValue) {
  return pathValue.split('.').reduce((value, key) => value?.[key], source) === true;
}

function applyCheckboxesXml(xml, checkboxes, pageNumber) {
  let result = xml
    .replace(/<w:sym\b[^>]*w:font="Wingdings 2"[^>]*w:char="F052"[^>]*\/>/g, '<w:t>□</w:t>');
  result = replaceAllVisibleText(result, '■', '□');
  result = clearSmallCheckboxShapes(result);

  const page1Definitions = [
    ['領用統一發票購票證申請書', '設立', 'page1.registration.establishment', 250],
    ['領用統一發票購票證申請書', '變更登記', 'page1.registration.change', 300],
    ['領用統一發票購票證申請書', '其他核准字號', 'page1.registration.other', 350],
    ['領用原因', '新領', 'page1.reason.new', 180],
    ['領用原因', '變更登記換發', 'page1.reason.change', 220],
    ['領用原因', '遺失補發', 'page1.reason.lost', 260],
    ['領用原因', '毀損補發', 'page1.reason.damaged', 300],
    ['領用原因', '其他（', 'page1.reason.other', 350],
    ['與營業人之關係', '代理人', 'page1.relation.agent', 220],
    ['與營業人之關係', '其他', 'page1.relation.otherOffice', 420],
    ['請領統一發票', '二聯式收銀機', 'page1.invoiceTypes.twoCopyRegister', 420],
    ['請領統一發票', '三聯式收銀機', 'page1.invoiceTypes.threeCopyRegister', 460],
    ['請領統一發票', '特種', 'page1.invoiceTypes.special', 520],
    ['請領統一發票', '二聯式', 'page1.invoiceTypes.twoCopy', 240],
    ['請領統一發票', '三聯式', 'page1.invoiceTypes.threeCopy', 300],
  ];
  const page2Definitions = [
    ['營業人委任代理', '購買統一發票', 'page2.services.purchase', 260],
    ['營業人委任代理', '領取統一發票購票證', 'page2.services.receiveCertificate', 360],
    ['茲委任具有', '會計師', 'page2.qualification.accountant', 120],
    ['茲委任具有', '記帳士', 'page2.qualification.bookkeeper', 180],
    ['茲委任具有', '記帳及報稅代理業務人資格', 'page2.qualification.taxAgent', 300],
    ['統一發票作業', '代理本公司（行號）購買統一發票', 'page2.actions.purchase', 260],
    ['統一發票作業', '領取本公司（行號）統一發票購票證', 'page2.actions.receiveCertificate', 420],
  ];
  for (const [anchor, label, pathValue, limit] of pageNumber === 1 ? page1Definitions : pageNumber === 2 ? page2Definitions : []) {
    result = setInlineCheckbox(result, { anchor, label, checked: boolAt(checkboxes, pathValue), limit });
  }

  if (pageNumber === 1) {
    const paragraphDefinitions = [
      ['繳驗附件', '負責人身分證正本', 'page1.attachments.responsibleIdOriginal'],
      ['繳驗附件', '委託代理人領取', 'page1.attachments.agentPickup'],
      ['與營業人之關係', '負責人', 'page1.relation.responsible'],
      ['與營業人之關係', '員工（職稱）', 'page1.relation.employee'],
    ];
    for (const [anchor, label, pathValue] of paragraphDefinitions) {
      result = setParagraphCheckbox(result, { anchor, label, checked: boolAt(checkboxes, pathValue) });
    }
  }
  return result;
}

function replaceOfficeTemplateValues(xml, office) {
  if (!office) return xml;
  const source = TEMPLATE_OFFICE_VALUES.generic;
  const compactPhone = String(office.phone || '').replace(/[^0-9]/g, '');
  const groups = [
    [source.names, office.name],
    [source.addresses, office.address],
    [source.responsiblePersonIds, office.responsiblePersonId],
    [source.responsiblePeople, office.responsiblePerson],
    [source.unifiedNumbers, office.unifiedNumber],
    [source.compactPhones, compactPhone],
    [source.phones, office.phone],
    [source.mediaCodes, office.mediaCode],
    [source.licenseNumbers, office.licenseNumber],
  ];
  let result = xml;
  for (const [oldValues, newValue] of groups) {
    if (!newValue) continue;
    for (const oldValue of oldValues) result = replaceAllVisibleText(result, oldValue, String(newValue));
  }
  return result;
}

function correctDuplicatedOfficeCellsXml(xml, office) {
  const tablePattern = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  let match;
  while ((match = tablePattern.exec(xml))) {
    const table = match[0];
    const cellPattern = /<w:tc\b[\s\S]*?<\/w:tc>/g;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellPattern.exec(table))) {
      cells.push({ start: cellMatch.index, end: cellPattern.lastIndex, xml: cellMatch[0] });
    }
    const labels = cells.map((cell) => extractVisibleText(cell.xml).trim());
    const duplicateIndexes = labels.map((label, index) => label === '扣繳統一編號' ? index : -1).filter((index) => index >= 0);
    if (duplicateIndexes.length < 2) continue;
    const base = duplicateIndexes[1];
    const corrections = [
      [0, '媒體代號', office.mediaCode],
      [4, '證書字號', office.licenseNumber],
      [8, '聯絡電話', office.phone],
    ];
    let nextTable = table;
    const edits = [];
    for (const [offset, label, value] of corrections) {
      const labelCell = cells[base + offset];
      const valueCell = cells[base + offset + 1];
      if (!labelCell || !valueCell) continue;
      edits.push({ ...labelCell, replacement: replaceCellTextXml(labelCell.xml, label) });
      edits.push({ ...valueCell, replacement: replaceCellTextXml(valueCell.xml, value) });
    }
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      nextTable = `${nextTable.slice(0, edit.start)}${edit.replacement}${nextTable.slice(edit.end)}`;
    }
    return `${xml.slice(0, match.index)}${nextTable}${xml.slice(tablePattern.lastIndex)}`;
  }
  return xml;
}

function applyStaticDatesXml(xml, pageNumber, officialDate, applicationDate, hasApplicationDayField) {
  let result = xml;
  if (pageNumber === 1) {
    result = replaceBetweenVisible(
      result,
      '其他核准字號：',
      '中區國稅',
      ` ${officialDate.year || '   '}年${officialDate.month || '  '}月${officialDate.day || '  '}日`,
      120,
    );
    result = insertBeforeVisibleLabel(result, '中華民國：', '月', applicationDate.month, 100);
    result = insertBeforeVisibleLabel(result, '中華民國：', '日', applicationDate.day, 130);
  }
  if (pageNumber === 2 || pageNumber === 3) {
    result = replaceBetweenVisible(
      result,
      '自中華民國',
      '月起依據',
      `  ${applicationDate.year || '   '}  年 ${applicationDate.month || '  '}`,
      120,
    );
  }
  if (pageNumber === 4) {
    if (!hasApplicationDayField) {
      result = insertBeforeVisibleLabel(result, '中　華　民　國', '日', applicationDate.day, 160);
    }
    result = replaceVisibleRegex(
      result,
      /\d{2,3}\s*年\s*1\s*月至\s*140\s*年\s*12\s*月/,
      `${applicationDate.year}年1月至140年12月`,
    );
  }
  return result;
}

function applyTaxBureauXml(xml, taxBureauName, pageNumber) {
  if (!taxBureauName) return xml;
  let result = xml;
  if (pageNumber === 1) {
    result = replaceBetweenVisible(
      result,
      '財政部',
      '國稅局領用統一發票購票證申請書',
      ` ${taxBureauName} `,
      80,
    );
  }
  result = replaceAllVisibleText(result, '中區國稅', `${taxBureauName}國稅`);
  result = replaceAllVisibleText(
    result,
    `財政部臺灣省${taxBureauName}國稅局`,
    `財政部${taxBureauName}國稅局`,
  );
  return result;
}

function transformPage(pageXml, pageNumber, { request, customer, office, page4Office }) {
  const hasApplicationDayField = /<w:instrText\b[^>]*>[^<]*申請日[^<]*<\/w:instrText>/.test(pageXml);
  const fields = {
    公文民國年: request.officialDate.year,
    公文月: request.officialDate.month,
    公文日: request.officialDate.day,
    分局稽徵所名稱: request.branchName,
    銷售字號: request.salesDocumentNumber,
    單位統一編號: customer.unifiedNumber,
    稅籍編號: customer.taxRegistrationNumber,
    單位名稱: customer.companyName,
    負責人姓名: customer.responsiblePerson,
    單位地址: customer.address,
    信箱: customer.email,
    營業人電話: customer.phone,
    負責人身份證字號: customer.responsiblePersonId,
    申請民國年: request.applicationDate.year,
    申請月: request.applicationDate.month,
    申請日: request.applicationDate.day,
  };
  let result = materializeFieldsXml(pageXml, fields, formatChineseApplicationDate(request.applicationDate));
  result = applyStaticDatesXml(
    result,
    pageNumber,
    request.officialDate,
    request.applicationDate,
    hasApplicationDayField,
  );
  result = applyTaxBureauXml(result, request.taxBureauName, pageNumber);
  result = replaceOfficeTemplateValues(
    result,
    pageNumber === 4 ? page4Office : office,
  );
  if (pageNumber === 3) result = correctDuplicatedOfficeCellsXml(result, office);
  result = applyCheckboxesXml(result, request.checkboxes, pageNumber);
  return setAllTextBlackXml(result);
}

async function generatePurchaseProofDocx({ request, customer, office, page4Office }) {
  const sourceBuffer = await readFile(templatePath());
  const files = unzipSync(sourceBuffer);
  const documentPart = files['word/document.xml'];
  if (!documentPart) throw new Error('Word 範本缺少 word/document.xml');
  const documentXml = strFromU8(documentPart);
  const parts = splitDocumentPages(documentXml);
  const selected = new Set(request.selectedPages);
  const transformedPages = parts.pages.map((elements, index) => (
    selected.has(index + 1)
      ? splitTopLevelFragment(transformPage(
        elements.join(''),
        index + 1,
        { request, customer, office, page4Office },
      ))
      : elements
  ));
  const outputXml = assembleSelectedPages(parts, request.selectedPages, transformedPages);
  if (/<w:(?:fldChar|instrText)\b/.test(outputXml)) throw new Error('Word 欄位未完全實體化');
  files['word/document.xml'] = strToU8(outputXml);

  if (files['word/settings.xml']) {
    files['word/settings.xml'] = strToU8(detachMailMergeSettings(strFromU8(files['word/settings.xml'])));
  }
  if (files['word/_rels/settings.xml.rels']) {
    files['word/_rels/settings.xml.rels'] = strToU8(
      emptySettingsRelationships(strFromU8(files['word/_rels/settings.xml.rels'])),
    );
  }

  return Buffer.from(zipSync(files, { level: 6 }));
}

export {
  PAGE_TITLES,
  applyCheckboxesXml,
  assembleSelectedPages,
  correctDuplicatedOfficeCellsXml,
  detachMailMergeSettings,
  extractVisibleText,
  generatePurchaseProofDocx,
  materializeFieldsXml,
  replaceAllVisibleText,
  splitDocumentPages,
  templatePath,
  textNodes,
};
