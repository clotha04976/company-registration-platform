import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const workerPath = join(rootDir, "ocr-service", "captcha_worker.py");
const pending = new Map();
let worker = null;
let outputBuffer = "";
let lastError = "";

function interpreter() {
  const configured = String(process.env.CAPTCHA_OCR_PYTHON || "").trim();
  if (configured) return { command: configured, prefix: [] };
  const candidates = process.platform === "win32"
    ? [
      join(rootDir, "ocr-service", ".captcha-venv", "Scripts", "python.exe"),
      join(rootDir, "ocr-service", ".venv", "Scripts", "python.exe"),
    ]
    : [
      join(rootDir, "ocr-service", ".captcha-venv", "bin", "python"),
      join(rootDir, "ocr-service", ".venv", "bin", "python"),
    ];
  const local = candidates.find((candidate) => existsSync(candidate));
  if (local) return { command: local, prefix: [] };
  return process.platform === "win32"
    ? { command: "py", prefix: ["-3.11"] }
    : { command: "python3", prefix: [] };
}

function rejectPending(message) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(message));
  }
  pending.clear();
}

function handleLine(line) {
  if (!line.trim()) return;
  let payload;
  try { payload = JSON.parse(line); }
  catch { lastError = line.trim().slice(0, 500); return; }
  const request = pending.get(payload.id);
  if (!request) return;
  pending.delete(payload.id);
  clearTimeout(request.timer);
  if (payload.error) request.reject(new Error(String(payload.error)));
  else request.resolve(String(payload.text || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 6));
}

function startWorker() {
  if (worker && worker.exitCode === null) return worker;
  const selected = interpreter();
  lastError = "";
  outputBuffer = "";
  worker = spawn(selected.command, [...selected.prefix, "-u", workerPath], {
    cwd: join(rootDir, "ocr-service"),
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  worker.stdout.setEncoding("utf8");
  worker.stdout.on("data", (chunk) => {
    outputBuffer += chunk;
    const lines = outputBuffer.split(/\r?\n/);
    outputBuffer = lines.pop() || "";
    lines.forEach(handleLine);
  });
  worker.stderr.setEncoding("utf8");
  worker.stderr.on("data", (chunk) => { lastError = String(chunk).trim().slice(-800); });
  worker.on("error", (error) => rejectPending(`驗證碼 OCR 無法啟動：${error.message}`));
  worker.on("exit", () => {
    const message = lastError || "驗證碼 OCR 已停止";
    worker = null;
    rejectPending(message);
  });
  return worker;
}

export function recognizeTaxCaptcha(image, { timeoutMs = 15_000 } = {}) {
  if (!Buffer.isBuffer(image) || !image.length) return Promise.reject(new Error("驗證碼圖片是空的"));
  const child = startWorker();
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("驗證碼 OCR 逾時"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, image: image.toString("base64") })}\n`, (error) => {
      if (!error) return;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function closeCaptchaOcr() {
  if (worker && worker.exitCode === null) worker.kill();
  worker = null;
}
