import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";

const runnerPath = fileURLToPath(new URL("./run_service.py", import.meta.url));

export interface PythonService {
  /** Prefix used on every relayed log line. */
  name: string;
  /** Service root holding both `.venv` and the `app` package. */
  directory: string;
  host: string;
  port: number;
  /** ASGI target passed to uvicorn. */
  target?: string;
  env?: Record<string, string>;
  /** Shown when `.venv` is missing, so the user knows which script builds it. */
  setupHint?: string;
}

/** A live connection means someone already owns the port, so we must not bind it again. */
function isPortTaken(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (taken: boolean) => {
      socket.destroy();
      resolve(taken);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(1000, () => settle(false));
  });
}

function interpreterFor(directory: string): string | undefined {
  const candidates = [
    path.join(directory, ".venv", "Scripts", "python.exe"),
    path.join(directory, ".venv", "bin", "python"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Forward the child's output line by line. Buffering the tail matters because a
 * chunk boundary can land mid-line, which would otherwise split a log entry.
 */
function relay(
  stream: NodeJS.ReadableStream | null,
  emit: (line: string) => void,
  prefix: string,
): void {
  if (!stream) return;
  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) emit(`${prefix} ${line}`);
    }
  });
}

/**
 * Run the local FastAPI services as children of the dev server so the whole
 * stack lives in one terminal and shuts down together. Leftover uvicorn
 * processes used to survive a closed window and then block the port on the next
 * start with "error while attempting to bind".
 */
export function pythonServices(services: PythonService[]): Plugin {
  const children = new Set<ChildProcess>();
  let stopping = false;

  function stopAll(): void {
    stopping = true;
    for (const child of children) {
      const { pid } = child;
      if (pid === undefined || child.exitCode !== null) continue;
      if (process.platform === "win32") {
        // Windows will not deliver a signal to the tree, and uvicorn's
        // "[standard]" extras can leave a watcher behind without /T.
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    }
    children.clear();
  }

  async function startAll(server: ViteDevServer | PreviewServer): Promise<void> {
    const { logger } = server.config;
    for (const service of services) {
      const label = `[${service.name}]`;
      if (await isPortTaken(service.host, service.port)) {
        logger.info(`${label} 已在 http://${service.host}:${service.port} 執行，沿用既有服務。`);
        continue;
      }
      const python = interpreterFor(service.directory);
      if (!python) {
        const hint = service.setupHint ? `請先執行 ${service.setupHint} 建立虛擬環境。` : "";
        logger.warn(`${label} 找不到 .venv，未啟動。${hint}`);
        continue;
      }
      const child = spawn(
        python,
        [
          runnerPath,
          service.target ?? "app.main:app",
          service.host,
          String(service.port),
          // The runner exits on its own once this process is gone, which covers
          // the closed-window case where no shutdown hook ever runs.
          String(process.pid),
        ],
        {
          cwd: service.directory,
          env: { ...process.env, ...service.env },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      children.add(child);
      relay(child.stdout, (line) => logger.info(line), label);
      // uvicorn logs to stderr by default, so this is the normal channel.
      relay(child.stderr, (line) => logger.info(line), label);
      child.on("error", (error) => logger.error(`${label} 啟動失敗：${error.message}`));
      child.on("exit", (code) => {
        children.delete(child);
        if (!stopping && code !== 0) logger.error(`${label} 結束，代碼 ${code}。`);
      });
      logger.info(`${label} 啟動於 http://${service.host}:${service.port}`);
    }

    server.httpServer?.once("close", stopAll);
  }

  process.once("SIGINT", stopAll);
  process.once("SIGTERM", stopAll);
  process.once("exit", stopAll);

  return {
    name: "python-services",
    configureServer: startAll,
    configurePreviewServer: startAll,
    closeBundle: stopAll,
  };
}
