// Word (OOXML) document.xml 的低階操作工具。
//
// 這些函式只認得 WordprocessingML，不知道任何表單語意，購票證明申請書
// (purchaseProofWordService) 與停復業申請書 (suspensionWordService) 共用。
//
// 核心概念是「可見文字座標」：把 document.xml 裡所有 <w:t> 串成一條字串，
// 用這條字串的索引來定位並取代內容，就不必在意 Word 把同一句話拆成幾個 run。

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textNodes(xml) {
  const nodes = [];
  const pattern = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
  let visibleOffset = 0;
  let match;
  while ((match = pattern.exec(xml))) {
    const text = decodeXml(match[2]);
    nodes.push({
      start: match.index,
      end: pattern.lastIndex,
      attributes: match[1],
      text,
      visibleStart: visibleOffset,
      visibleEnd: visibleOffset + text.length,
    });
    visibleOffset += text.length;
  }
  return nodes;
}

function extractVisibleText(xml) {
  return textNodes(xml).map((node) => node.text).join('');
}

function textElement(node, value) {
  const attributes = /\bxml:space=/.test(node.attributes)
    ? node.attributes
    : `${node.attributes} xml:space="preserve"`;
  return `<w:t${attributes}>${escapeXml(value)}</w:t>`;
}

function replaceVisibleRange(xml, start, end, replacement) {
  const nodes = textNodes(xml);
  if (!nodes.length || start < 0 || end < start) return xml;

  if (start === end) {
    const node = nodes.find((candidate) => (
      start >= candidate.visibleStart && start <= candidate.visibleEnd
    ));
    if (!node) return xml;
    const offset = start - node.visibleStart;
    const nextText = `${node.text.slice(0, offset)}${replacement}${node.text.slice(offset)}`;
    return `${xml.slice(0, node.start)}${textElement(node, nextText)}${xml.slice(node.end)}`;
  }

  const affected = nodes.filter((node) => node.visibleEnd > start && node.visibleStart < end);
  if (!affected.length) return xml;
  const first = affected[0];
  const last = affected[affected.length - 1];
  const firstOffset = Math.max(0, start - first.visibleStart);
  const lastOffset = Math.max(0, end - last.visibleStart);
  const prefix = first.text.slice(0, firstOffset);
  const suffix = last.text.slice(lastOffset);
  const replacements = affected.map((node, index) => {
    let value = '';
    if (index === 0) value = `${prefix}${replacement}${first === last ? suffix : ''}`;
    else if (node === last) value = suffix;
    return { ...node, value };
  });
  let result = xml;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const node = replacements[index];
    result = `${result.slice(0, node.start)}${textElement(node, node.value)}${result.slice(node.end)}`;
  }
  return result;
}

function replaceFirstVisibleText(xml, search, replacement, { startAt = 0, limit = Infinity } = {}) {
  if (!search || search === replacement) return xml;
  const visible = extractVisibleText(xml);
  const index = visible.indexOf(search, startAt);
  if (index < 0 || index - startAt > limit) return xml;
  return replaceVisibleRange(xml, index, index + search.length, replacement);
}

function replaceAllVisibleText(xml, search, replacement) {
  if (!search || search === replacement) return xml;
  let result = xml;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const visible = extractVisibleText(result);
    const index = visible.indexOf(search);
    if (index < 0) return result;
    result = replaceVisibleRange(result, index, index + search.length, replacement);
  }
  throw new Error(`DOCX 文字取代次數異常：${search}`);
}

function replaceVisibleRegex(xml, regex, replacement, startAt = 0) {
  const visible = extractVisibleText(xml);
  const scoped = visible.slice(startAt);
  const flags = regex.flags.replace(/g/g, '');
  const match = new RegExp(regex.source, flags).exec(scoped);
  if (!match) return xml;
  const start = startAt + match.index;
  const value = typeof replacement === 'function' ? replacement(...match) : replacement;
  return replaceVisibleRange(xml, start, start + match[0].length, value);
}

function replaceBetweenVisible(xml, startAnchor, endAnchor, replacement, limit = Infinity, startAt = 0) {
  const visible = extractVisibleText(xml);
  const startAnchorIndex = visible.indexOf(startAnchor, startAt);
  if (startAnchorIndex < 0) return xml;
  const start = startAnchorIndex + startAnchor.length;
  const end = visible.indexOf(endAnchor, start);
  if (end < 0 || end - start > limit) return xml;
  return replaceVisibleRange(xml, start, end, replacement);
}

function insertBeforeVisibleLabel(xml, anchor, label, value, limit = Infinity) {
  if (!value) return xml;
  const visible = extractVisibleText(xml);
  const anchorIndex = visible.indexOf(anchor);
  if (anchorIndex < 0) return xml;
  const start = anchorIndex + anchor.length;
  const labelIndex = visible.indexOf(label, start);
  if (labelIndex < 0 || labelIndex - start > limit) return xml;
  return replaceVisibleRange(xml, labelIndex, labelIndex, String(value));
}

function splitTopLevelBody(documentXml) {
  const bodyOpen = /<w:body\b[^>]*>/.exec(documentXml);
  const bodyCloseIndex = documentXml.lastIndexOf('</w:body>');
  if (!bodyOpen || bodyCloseIndex < 0) throw new Error('Word 範本缺少 w:body');
  const innerStart = bodyOpen.index + bodyOpen[0].length;
  const inner = documentXml.slice(innerStart, bodyCloseIndex);
  const elements = [];
  const tokenPattern = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\/?>/g;
  let depth = 0;
  let elementStart = -1;
  let token;
  while ((token = tokenPattern.exec(inner))) {
    const raw = token[0];
    const closing = raw.startsWith('</');
    const selfClosing = raw.endsWith('/>');
    if (!closing && depth === 0) elementStart = token.index;
    if (closing) depth -= 1;
    else if (!selfClosing) depth += 1;
    if ((closing || selfClosing) && depth === 0 && elementStart >= 0) {
      elements.push(inner.slice(elementStart, tokenPattern.lastIndex));
      elementStart = -1;
    }
  }
  if (depth !== 0 || elementStart >= 0) throw new Error('Word 範本 body XML 結構不完整');
  return {
    prefix: documentXml.slice(0, innerStart),
    suffix: documentXml.slice(bodyCloseIndex),
    elements,
  };
}

function splitTopLevelFragment(fragment) {
  return splitTopLevelBody(`<w:document><w:body>${fragment}</w:body></w:document>`).elements;
}

// 從一段 body 元素中取出分節設定；如果分節設定所在的段落只是用來承載它，
// 就一併移除，避免留下空段落把版面撐開。
function sectionPropertyFromElements(elements) {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const match = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(elements[index]);
    if (!match) continue;
    const next = [...elements];
    const withoutSection = elements[index].replace(match[0], '');
    const meaningful = extractVisibleText(withoutSection).trim()
      || /<w:(?:pict|drawing|br)\b/.test(withoutSection);
    if (meaningful) next[index] = withoutSection;
    else next.splice(index, 1);
    return { elements: next, section: match[0] };
  }
  return { elements: [...elements], section: null };
}

function removeTrailingPageBreak(elements) {
  const next = [...elements];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (!/<w:br\b[^>]*w:type="page"[^>]*\/>/.test(next[index])) continue;
    const withoutBreak = next[index].replace(/<w:br\b[^>]*w:type="page"[^>]*\/>/g, '');
    const meaningful = extractVisibleText(withoutBreak).trim()
      || /<w:(?:pict|drawing)\b/.test(withoutBreak);
    if (meaningful) next[index] = withoutBreak;
    else next.splice(index, 1);
    break;
  }
  return next;
}

function fieldName(code) {
  const match = String(code || '').replace(/\s+/g, ' ').trim()
    .match(/^MERGEFIELD\s+(?:"([^"]+)"|([^\\\s]+))/i);
  return match?.[1] || match?.[2] || '';
}

function replaceRunText(runXml, value) {
  const textPattern = /<w:t\b([^>]*)>[\s\S]*?<\/w:t>/g;
  let replaced = false;
  let result = runXml.replace(textPattern, (match, attributes) => {
    if (replaced) return match.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/, '$1$2');
    replaced = true;
    const node = { attributes };
    return textElement(node, value);
  });
  result = result
    .replace(/<w:fldChar\b[^>]*\/>/g, '')
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '');
  if (!replaced) result = result.replace('</w:r>', `<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`);
  return result;
}

// 把 Word 的合併欄位（MERGEFIELD 複合欄位）換成實際文字，並移除欄位指令，
// 讓輸出檔不再依賴原本的資料來源。
function materializeFieldsXml(xml, values, timeFieldValue) {
  const runPattern = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let match;
  while ((match = runPattern.exec(xml))) runs.push({ start: match.index, end: runPattern.lastIndex, xml: match[0] });
  let cursor = 0;
  let result = '';
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
    if (endIndex < 0) throw new Error('Word 範本包含不完整的複合欄位');
    const instructionEndIndex = separateIndex >= 0 ? separateIndex : endIndex;
    const code = runs.slice(index, instructionEndIndex + 1).map((run) => (
      [...run.xml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)]
        .map((instruction) => decodeXml(instruction[1])).join('')
    )).join('');
    let value;
    if (/^\s*TIME\b/i.test(code)) value = timeFieldValue;
    else {
      const name = fieldName(code);
      if (!Object.hasOwn(values, name)) throw new Error(`Word 範本包含未知欄位：${name || code.trim()}`);
      value = values[name];
    }
    const resultRun = separateIndex >= 0
      ? runs.slice(separateIndex + 1, endIndex).find((run) => /<w:t\b/.test(run.xml))
      : null;
    const templateRun = resultRun?.xml || runs[index].xml;
    result += xml.slice(cursor, runs[index].start);
    result += replaceRunText(templateRun, String(value ?? ''));
    cursor = runs[endIndex].end;
    index = endIndex;
  }
  result += xml.slice(cursor);
  return result;
}

// 有些範本用小方框圖形當勾選格，列印時會蓋住底下的文字，統一填白。
function clearSmallCheckboxShapes(xml) {
  return xml.replace(/<v:shape\b[^>]*>[\s\S]*?<\/v:shape>/g, (shape) => {
    const opening = /^<v:shape\b[^>]*>/.exec(shape)?.[0];
    if (!opening || extractVisibleText(shape).trim()) return shape;
    const style = /\bstyle="([^"]*)"/.exec(opening)?.[1] || '';
    const width = Number(/(?:^|;)width:([\d.]+)pt/.exec(style)?.[1]);
    const height = Number(/(?:^|;)height:([\d.]+)pt/.exec(style)?.[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width > 15 || height > 12) return shape;
    let nextOpening = opening;
    if (/\bfilled="[^"]*"/.test(nextOpening)) nextOpening = nextOpening.replace(/\bfilled="[^"]*"/, 'filled="t"');
    else nextOpening = nextOpening.replace('<v:shape', '<v:shape filled="t"');
    if (/\bfillcolor="[^"]*"/.test(nextOpening)) nextOpening = nextOpening.replace(/\bfillcolor="[^"]*"/, 'fillcolor="white"');
    else nextOpening = nextOpening.replace('<v:shape', '<v:shape fillcolor="white"');
    return shape.replace(opening, nextOpening);
  });
}

// 在 anchor 之後找到 label，把 label 前面最近的 □／■ 設成指定狀態。
function setInlineCheckbox(xml, { anchor, label, checked, limit = 500, startAt = 0 }) {
  const visible = extractVisibleText(xml);
  const anchorIndex = visible.indexOf(anchor, startAt);
  if (anchorIndex < 0) return xml;
  const labelIndex = visible.indexOf(label, anchorIndex + anchor.length);
  if (labelIndex < 0 || labelIndex - anchorIndex > limit) return xml;
  const preceding = visible.slice(Math.max(0, labelIndex - 12), labelIndex);
  const relativeCheckboxIndex = Math.max(preceding.lastIndexOf('□'), preceding.lastIndexOf('■'));
  if (relativeCheckboxIndex < 0) return xml;
  const checkboxIndex = Math.max(0, labelIndex - 12) + relativeCheckboxIndex;
  return replaceVisibleRange(xml, checkboxIndex, checkboxIndex + 1, checked ? '■' : '□');
}

// 勾選格是段落編號（w:numPr）畫出來的情況：改成在段落開頭補一個 ■ 字元。
function setParagraphCheckbox(xml, { anchor, label, checked }) {
  if (!checked) return xml;
  const paragraphPattern = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let anchorSeen = false;
  let match;
  while ((match = paragraphPattern.exec(xml))) {
    const paragraphText = extractVisibleText(match[0]);
    if (paragraphText.includes(anchor)) anchorSeen = true;
    if (!anchorSeen || !paragraphText.includes(label)) continue;
    let paragraph = match[0].replace(/<w:numPr\b[\s\S]*?<\/w:numPr>/g, '');
    const labelIndex = extractVisibleText(paragraph).indexOf(label);
    const preceding = extractVisibleText(paragraph).slice(Math.max(0, labelIndex - 6), labelIndex);
    const relativeCheckboxIndex = Math.max(preceding.lastIndexOf('□'), preceding.lastIndexOf('■'));
    if (relativeCheckboxIndex >= 0) {
      const checkboxIndex = Math.max(0, labelIndex - 6) + relativeCheckboxIndex;
      paragraph = replaceVisibleRange(paragraph, checkboxIndex, checkboxIndex + 1, '■');
      return `${xml.slice(0, match.index)}${paragraph}${xml.slice(paragraphPattern.lastIndex)}`;
    }
    const checkboxRun = '<w:r><w:rPr><w:rFonts w:ascii="標楷體" w:eastAsia="標楷體" w:hAnsi="標楷體"/><w:color w:val="000000"/></w:rPr><w:t>■</w:t></w:r>';
    if (/<w:pPr\b[\s\S]*?<\/w:pPr>/.test(paragraph)) {
      paragraph = paragraph.replace(/(<w:pPr\b[\s\S]*?<\/w:pPr>)/, `$1${checkboxRun}`);
    } else {
      paragraph = paragraph.replace(/^(<w:p\b[^>]*>)/, `$1${checkboxRun}`);
    }
    return `${xml.slice(0, match.index)}${paragraph}${xml.slice(paragraphPattern.lastIndex)}`;
  }
  return xml;
}

function replaceCellTextXml(cellXml, value) {
  const nodes = textNodes(cellXml);
  if (!nodes.length) return cellXml;
  return replaceVisibleRange(cellXml, 0, nodes[nodes.length - 1].visibleEnd, String(value || ''));
}

// 範本常見淺灰／主題色文字，列印或影印會不清楚，一律轉黑。
function setAllTextBlackXml(xml) {
  return xml.replace(/<w:color\b[^>]*>/g, (tag) => {
    let next = tag
      .replace(/\s+w:themeColor="[^"]*"/g, '')
      .replace(/\s+w:themeTint="[^"]*"/g, '')
      .replace(/\s+w:themeShade="[^"]*"/g, '');
    if (/\bw:val="[^"]*"/.test(next)) return next.replace(/\bw:val="[^"]*"/, 'w:val="000000"');
    return next.replace(/\/?>(?=$)/, ' w:val="000000"/>');
  });
}

function detachMailMergeSettings(settingsXml) {
  return String(settingsXml || '').replace(/<w:mailMerge\b[\s\S]*?<\/w:mailMerge>/, '');
}

function emptySettingsRelationships(relationshipsXml) {
  return String(relationshipsXml || '').replace(
    /<Relationship\b[^>]*Type="[^"]*\/mailMergeSource"[^>]*\/>/g,
    '',
  );
}

export {
  clearSmallCheckboxShapes,
  decodeXml,
  detachMailMergeSettings,
  emptySettingsRelationships,
  escapeXml,
  extractVisibleText,
  fieldName,
  insertBeforeVisibleLabel,
  materializeFieldsXml,
  removeTrailingPageBreak,
  replaceAllVisibleText,
  replaceBetweenVisible,
  replaceCellTextXml,
  replaceFirstVisibleText,
  replaceRunText,
  replaceVisibleRange,
  replaceVisibleRegex,
  sectionPropertyFromElements,
  setAllTextBlackXml,
  setInlineCheckbox,
  setParagraphCheckbox,
  splitTopLevelBody,
  splitTopLevelFragment,
  textElement,
  textNodes,
};
