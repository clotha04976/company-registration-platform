import {
  identityCropCandidates,
  isCompleteIdentityResult,
  isValidTaiwanNationalId,
  parseTaiwanIdentityText,
  selectRotationCandidate,
} from "./identity-extraction.mjs";

const TARGET_CONTEXTS = [
  "租賃標的",
  "房屋所在地",
  "租賃地址",
  "標的物",
  "坐落",
];
const NEGATIVE_CONTEXTS = [
  "出租人",
  "承租人",
  "戶籍",
  "通訊",
  "聯絡地址",
  "戶籍地址",
  "通訊地址",
];
const ADDRESS_PATTERN =
  /(?:\d{3,5}\s*)?(?:臺灣省)?(?:臺北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)[\u4e00-\u9fff]{1,8}(?:區|鄉|鎮|市)(?:[\u4e00-\u9fffA-Za-z0-9０-９一二三四五六七八九十百甲乙丙丁之、．.\-]{1,30})(?:路|街|大道|巷|弄|號|樓)(?:[\u4e00-\u9fffA-Za-z0-9０-９一二三四五六七八九十百之、．.\-]{0,24})/g;

export function normalizeTaiwanAddress(value) {
  return String(value)
    .replace(/\s+/g, "")
    .replace(/^\d{3,5}/, "")
    .replace(/臺灣省/g, "")
    .replace(/台北市/g, "臺北市")
    .replace(/台中市/g, "臺中市")
    .replace(/台南市/g, "臺南市")
    .replace(/台東縣/g, "臺東縣")
    .replace(/[，,。；;：:].*$/, "")
    .replace(/[（(].*$/, "")
    .trim();
}

const contextWindow = (text, start, end) =>
  text.slice(Math.max(0, start - 28), Math.min(text.length, end + 28));

export function extractAddressCandidates(pages, sourceFile) {
  const candidates = [];
  for (const page of pages) {
    const text = String(page.text ?? "").replace(/\r/g, "\n");
    for (const match of text.matchAll(ADDRESS_PATTERN)) {
      const address = normalizeTaiwanAddress(match[0]);
      if (address.length < 8 || /[A-Z][12]\d{8}/.test(address)) continue;
      const evidence = contextWindow(
        text,
        match.index ?? 0,
        (match.index ?? 0) + match[0].length,
      )
        .replace(/\s+/g, " ")
        .trim();
      const positive = TARGET_CONTEXTS.filter((keyword) =>
        evidence.includes(keyword),
      );
      const negative = NEGATIVE_CONTEXTS.filter((keyword) =>
        evidence.includes(keyword),
      );
      let score = 35 + Math.min(20, address.length);
      score += positive.length * 35;
      score -= negative.length * 42;
      if (/\d+(?:號|樓)/.test(address)) score += 12;
      if (/姓名|身分證|出生/.test(evidence)) score -= 35;
      const confidence = score >= 85 ? "高" : score >= 55 ? "中" : "低";
      candidates.push({
        address,
        sourceFile,
        page: page.page,
        pageRange: String(page.page),
        confidence,
        evidence,
        score,
      });
    }
  }
  const best = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.sourceFile}:${candidate.address}`;
    if (!best.has(key) || best.get(key).score < candidate.score)
      best.set(key, candidate);
  }
  return [...best.values()].sort(
    (a, b) => b.score - a.score || a.page - b.page,
  );
}

export function formatPageRange(pageNumbers) {
  const pages = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const segments = [];
  for (let index = 0; index < pages.length; index += 1) {
    const start = pages[index];
    let end = start;
    while (pages[index + 1] === end + 1) {
      end = pages[++index];
    }
    segments.push(start === end ? String(start) : `${start}-${end}`);
  }
  return segments.join(",");
}

export function parsePageRange(value, pageCount) {
  if (!String(value).trim()) throw new Error("頁碼不可空白");
  const pages = [];
  for (const segment of String(value).split(",")) {
    const match = segment.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error("頁碼格式不正確");
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount)
      throw new Error("頁碼超出文件範圍");
    for (let page = start; page <= end; page += 1) pages.push(page);
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

export function detectIncludedDocuments(pages, sourceFile) {
  const definitions = [
    ["lease", "租約", ["租賃契約", "租賃標的", "出租人", "承租人"]],
    ["house_tax", "房屋稅單", ["房屋稅繳款書", "房屋稅", "房屋稅籍"]],
    [
      "land_title",
      "土地權狀",
      ["土地所有權狀", "建物所有權狀", "土地權狀", "地號", "權利範圍"],
    ],
    [
      "building_consent",
      "建物所有人同意書",
      ["建物所有人同意", "房屋使用同意", "使用同意書", "同意作為公司登記"],
    ],
    ["floor_plan", "平面圖", ["平面圖", "位置圖", "配置圖", "比例尺", "圖例"]],
  ];
  const results = [];
  for (const page of pages) {
    const checklistPage = /文件簽收確認單|提供以下資料|逐一核對/.test(
      page.text,
    );
    for (const [key, label, keywords] of definitions) {
      if (checklistPage && key !== "lease") continue;
      const matched = keywords.filter((keyword) => page.text.includes(keyword));
      if (matched.length)
        results.push({
          key,
          label,
          sourceFile,
          page: page.page,
          pageRange: String(page.page),
          evidence: matched.join("、"),
          score: Math.min(100, matched.length * 35),
          confidence: matched.length >= 2 ? "高" : "低",
        });
    }
  }
  const merged = [];
  for (const [key, label] of definitions) {
    const hits = results.filter((result) => result.key === key);
    if (!hits.length) continue;
    const score = Math.max(...hits.map((hit) => hit.score));
    merged.push({
      key,
      label,
      sourceFile,
      pageRange: formatPageRange(hits.map((hit) => hit.page)),
      evidence: [
        ...new Set(hits.flatMap((hit) => hit.evidence.split("、"))),
      ].join("、"),
      score,
      confidence: score >= 70 ? "高" : "低",
    });
  }
  return merged;
}

export async function splitPdfPages(bytes, pageRange, pageCount) {
  const pages = parsePageRange(pageRange, pageCount);
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes);
  if (source.getPageCount() !== pageCount)
    throw new Error("PDF 頁數與辨識結果不一致");
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    pages.map((page) => page - 1),
  );
  copied.forEach((page) => output.addPage(page));
  return output.save();
}

export async function collectPageTexts(pageCount, extractPageText) {
  const pages = [];
  for (let page = 1; page <= pageCount; page += 1)
    pages.push({ page, text: await extractPageText(page) });
  return pages;
}

export function shouldRunPdfOcr(
  textLength,
  hasAddressCandidate,
  purpose = "address",
) {
  return textLength < 80 || (purpose === "address" && !hasAddressCandidate);
}

async function createOcrWorker(onProgress) {
  const { createWorker } = await import("tesseract.js");
  return createWorker("chi_tra+eng", undefined, {
    logger: (message) => {
      if (message.status === "recognizing text")
        onProgress?.(Math.round((message.progress ?? 0) * 100));
    },
  });
}

async function ocrImage(image, onProgress) {
  const worker = await createOcrWorker(onProgress);
  try {
    const result = await worker.recognize(image);
    return result.data.text ?? "";
  } finally {
    await worker.terminate();
  }
}

export async function extractDocument(file, onUpdate = () => {}, options = {}) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["doc", "docx"].includes(extension))
    return {
      status: "review",
      method: "人工確認",
      progress: 100,
      message: "目前無法自動辨識，請人工確認/填寫",
      pageCount: 0,
      pages: [],
      candidates: [],
      detections: [],
    };
  if (file.size > 25 * 1024 * 1024)
    return {
      status: "error",
      method: "限制",
      progress: 100,
      message: "檔案超過 25 MB，請分割後重新上傳",
      pageCount: 0,
      pages: [],
      candidates: [],
      detections: [],
    };
  try {
    let pages = [];
    let method = "OCR";
    if (extension === "pdf") {
      onUpdate({
        status: "extracting",
        progress: 5,
        method: "PDF 文字層",
        message: "正在讀取 PDF 文字層",
      });
      const pdfjs = await import("pdfjs-dist");
      const workerModule =
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
      }).promise;
      if (pdf.numPages > 25)
        return {
          status: "error",
          method: "限制",
          progress: 100,
          message: "PDF 超過 25 頁，請分割後重新上傳",
          pageCount: pdf.numPages,
          pages: [],
          candidates: [],
          detections: [],
        };
      const pageObjects = [];
      pages = await collectPageTexts(pdf.numPages, async (pageNumber) => {
        const page = await pdf.getPage(pageNumber);
        pageObjects.push(page);
        const content = await page.getTextContent();
        onUpdate({
          status: "extracting",
          progress: Math.round((pageNumber / pdf.numPages) * 45),
          method: "PDF 文字層",
          message: `已讀取第 ${pageNumber} 頁文字`,
        });
        return content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
      });
      let candidates = extractAddressCandidates(pages, file.name);
      const textLength = pages.reduce(
        (sum, page) => sum + page.text.trim().length,
        0,
      );
      if (
        shouldRunPdfOcr(
          textLength,
          candidates.some((candidate) => candidate.score >= 55),
          options.purpose ?? "address",
        )
      ) {
        method = "PDF 掃描 OCR";
        onUpdate({
          status: "ocr",
          progress: 46,
          method,
          message: "掃描 PDF 正在 OCR，可能需要較長時間",
        });
        const worker = await createOcrWorker((progress) =>
          onUpdate({
            status: "ocr",
            progress: 46 + Math.round(progress * 0.5),
            method,
            message: "掃描 PDF 正在 OCR，可能需要較長時間",
          }),
        );
        try {
          pages = [];
          for (let index = 0; index < pageObjects.length; index += 1) {
            const page = pageObjects[index];
            const viewport = page.getViewport({ scale: 1.8 });
            const scale = Math.min(
              1,
              1800 / Math.max(viewport.width, viewport.height),
            );
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(viewport.width * scale);
            canvas.height = Math.round(viewport.height * scale);
            const context = canvas.getContext("2d");
            if (!context) throw new Error("無法建立 OCR 畫布");
            await page.render({
              canvasContext: context,
              viewport: page.getViewport({ scale: 1.8 * scale }),
            }).promise;
            const result = await worker.recognize(canvas);
            pages.push({ page: index + 1, text: result.data.text ?? "" });
            onUpdate({
              status: "ocr",
              progress:
                50 + Math.round(((index + 1) / pageObjects.length) * 45),
              method,
              message: `已完成第 ${index + 1} 頁 OCR`,
            });
          }
        } finally {
          await worker.terminate();
        }
        candidates = extractAddressCandidates(pages, file.name);
      }
    } else if (["jpg", "jpeg", "png"].includes(extension)) {
      onUpdate({
        status: "ocr",
        progress: 5,
        method: "圖片 OCR",
        message: "正在辨識圖片",
      });
      pages = [
        {
          page: 1,
          text: await ocrImage(file, (progress) =>
            onUpdate({
              status: "ocr",
              progress,
              method: "圖片 OCR",
              message: "正在辨識圖片",
            }),
          ),
        },
      ];
      method = "圖片 OCR";
    } else
      return {
        status: "review",
        method: "人工確認",
        progress: 100,
        message: "目前無法自動辨識，請人工確認/填寫",
        pageCount: 0,
        pages: [],
        candidates: [],
        detections: [],
      };
    const candidates = extractAddressCandidates(pages, file.name);
    const detections = detectIncludedDocuments(pages, file.name);
    if (!candidates.length)
      return {
        status: "review",
        method,
        progress: 100,
        message: "未辨識到公司所在地，請人工填寫",
        pageCount: pages.length,
        pages,
        candidates,
        detections,
      };
    return {
      status: "success",
      method,
      progress: 100,
      message: "已辨識公司所在地",
      pageCount: pages.length,
      pages,
      candidates,
      detections,
    };
  } catch (error) {
    return {
      status: "error",
      method: "辨識失敗",
      progress: 100,
      message:
        error instanceof Error ? error.message : "文件辨識失敗，請人工確認",
      pageCount: 0,
      pages: [],
      candidates: [],
      detections: [],
    };
  }
}

const rotateCanvas = (source, degrees) => {
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("無法建立身分證方向校正畫布");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
};

const cropAndEnlarge = (source, crop) => {
  const canvas = document.createElement("canvas");
  canvas.width = crop.width * 2;
  canvas.height = crop.height * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("無法建立身分證局部強化畫布");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
};

async function rasterIdentityPages(file) {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("身分證檔案超過 25 MB，請人工輸入");
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;
    if (pdf.numPages > 25)
      throw new Error("身分證 PDF 超過 25 頁，請人工輸入");
    const canvases = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.8 });
      const scale = Math.min(
        1,
        1800 / Math.max(viewport.width, viewport.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width * scale);
      canvas.height = Math.round(viewport.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("無法建立身分證 PDF 畫布");
      await page.render({
        canvasContext: context,
        viewport: page.getViewport({ scale: 1.8 * scale }),
      }).promise;
      canvases.push(canvas);
    }
    return canvases;
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法建立身分證影像畫布");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [canvas];
  } finally {
    bitmap.close();
  }
}

export async function enhanceIdentityDocument(
  file,
  initialPages = [],
  onUpdate = () => {},
) {
  const candidates = [];
  const initial = {
    ...parseTaiwanIdentityText(initialPages),
    rotation: 0,
    strategy: "initial",
  };
  candidates.push(initial);
  if (isCompleteIdentityResult(initial)) return initial;

  onUpdate({
    status: "ocr",
    progress: 5,
    method: "身分證方向校正",
    message: "正在校正身分證方向",
  });
  const baseCanvases = await rasterIdentityPages(file);
  const worker = await createOcrWorker();
  try {
    for (const [angleIndex, rotation] of [0, 90, 180, 270].entries()) {
      const oriented = baseCanvases.map((canvas) =>
        rotation === 0 ? canvas : rotateCanvas(canvas, rotation),
      );
      let parsed = rotation === 0 ? initial : null;
      if (rotation !== 0) {
        const pages = [];
        for (let index = 0; index < oriented.length; index += 1) {
          const result = await worker.recognize(oriented[index]);
          pages.push({ page: index + 1, text: result.data.text ?? "" });
        }
        parsed = {
          ...parseTaiwanIdentityText(pages),
          rotation,
          strategy: "full-page",
        };
        candidates.push(parsed);
      }
      onUpdate({
        status: "ocr",
        progress: 15 + angleIndex * 18,
        method: "身分證方向校正",
        message: `正在檢查方向候選 ${angleIndex + 1}/4`,
      });
      if (isCompleteIdentityResult(parsed)) return parsed;
      if (isValidTaiwanNationalId(parsed?.nationalId) && !parsed?.name) {
        onUpdate({
          status: "ocr",
          progress: 25 + angleIndex * 18,
          method: "身分證局部強化",
          message: "已辨識證號，正在放大證件正面尋找姓名",
        });
        for (const canvas of oriented) {
          for (const crop of identityCropCandidates(
            canvas.width,
            canvas.height,
          )) {
            const result = await worker.recognize(
              cropAndEnlarge(canvas, crop),
            );
            const cropParsed = parseTaiwanIdentityText(result.data.text ?? "");
            if (cropParsed.name) {
              const combined = {
                name: cropParsed.name,
                nationalId: parsed.nationalId,
                rotation,
                strategy: `crop-${crop.key}-2x`,
              };
              candidates.push(combined);
              if (isCompleteIdentityResult(combined)) return combined;
            }
          }
        }
      }
    }
    return selectRotationCandidate(candidates) ?? initial;
  } finally {
    await worker.terminate();
  }
}
