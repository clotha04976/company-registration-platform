import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { nodeService } from "./build/node-service-plugin";
import { pythonServices, type PythonService } from "./build/python-services-plugin";

const root = path.dirname(fileURLToPath(import.meta.url));

// The ERP API is the local Node.js + SQLite service. Python is reserved for OCR.
const CASE_API_URL = process.env.CASE_API_URL ?? "http://127.0.0.1:5566";
const LOCAL_OCR_URL = "http://127.0.0.1:8689";
// Identity recognition is meant to move to the DuckyOCR workstation. Whenever it
// points anywhere but the local fallback, there is nothing for us to launch.
const IDENTITY_OCR_URL = process.env.VITE_IDENTITY_OCR_URL ?? LOCAL_OCR_URL;

const caseApi = new URL(CASE_API_URL);
const services: PythonService[] = [];

if (IDENTITY_OCR_URL === LOCAL_OCR_URL) {
  const ocr = new URL(LOCAL_OCR_URL);
  services.push({
    name: "identity-ocr",
    directory: path.join(root, "ocr-service"),
    host: ocr.hostname,
    port: Number(ocr.port),
    // Mirrors run-ocr-service.bat; Paddle picks these up at model load time.
    env: { FLAGS_use_mkldnn: "0", PADDLE_PDX_MODEL_SOURCE: "BOS" },
    setupHint: "ocr-service\\run-ocr-service.bat",
  });
}

export default defineConfig({
  plugins: [
    react(),
    nodeService({
      name: "erp-api",
      entry: path.join(root, "server.mjs"),
      host: caseApi.hostname,
      port: Number(caseApi.port || 80),
    }),
    pythonServices(services),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: CASE_API_URL, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: CASE_API_URL, changeOrigin: true },
    },
  },
});
