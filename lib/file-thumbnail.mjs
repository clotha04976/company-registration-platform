/**
 * Builds small preview images for uploaded files.
 *
 * Uploading the wrong scan is easy and, without a picture, invisible until the
 * generated paperwork is already wrong. Images are shown straight from an
 * object URL; PDFs get their first page rasterised through the same pdfjs build
 * the extractor already loads, so no extra dependency is involved.
 */
const THUMBNAIL_WIDTH = 220;

const isImage = (file) =>
  /^image\//.test(file?.type ?? "") ||
  /\.(jpe?g|png)$/i.test(file?.name ?? "");

const isPdf = (file) =>
  file?.type === "application/pdf" || /\.pdf$/i.test(file?.name ?? "");

async function renderPdfThumbnail(file) {
  const pdfjs = await import("pdfjs-dist");
  const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: THUMBNAIL_WIDTH / base.width,
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return "";
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    await pdf.destroy();
  }
}

/**
 * Returns `{ url, revoke }`. Callers must invoke `revoke` when the preview is
 * removed; object URLs stay alive for the whole session otherwise.
 */
export async function createFileThumbnail(file) {
  if (isImage(file)) {
    const url = URL.createObjectURL(file);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  if (!isPdf(file)) return { url: "", revoke: () => {} };
  try {
    return { url: await renderPdfThumbnail(file), revoke: () => {} };
  } catch {
    return { url: "", revoke: () => {} };
  }
}
