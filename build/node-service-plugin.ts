import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

type NodeServiceOptions = {
  name: string;
  entry: string;
  host: string;
  port: number;
};

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
    for (const line of lines) if (line.trim()) emit(`${prefix} ${line}`);
  });
}

export function nodeService(options: NodeServiceOptions): Plugin {
  let child: ChildProcess | null = null;

  const stop = () => {
    if (!child || child.exitCode !== null) return;
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
    child = null;
  };

  const start = async (server: ViteDevServer | PreviewServer) => {
    const label = `[${options.name}]`;
    if (await isPortTaken(options.host, options.port)) {
      server.config.logger.info(
        `${label} 已在 http://${options.host}:${options.port} 執行，沿用既有服務。`,
      );
      return;
    }
    child = spawn(process.execPath, [options.entry], {
      cwd: path.dirname(options.entry),
      env: {
        ...process.env,
        HOST: options.host,
        PORT: String(options.port),
        AUTO_OPEN: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    relay(child.stdout, (line) => server.config.logger.info(line), label);
    relay(child.stderr, (line) => server.config.logger.error(line), label);
    child.once("error", (error) =>
      server.config.logger.error(`${label} 啟動失敗：${error.message}`),
    );
    server.httpServer?.once("close", stop);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("exit", stop);

  return {
    name: "node-erp-service",
    configureServer: start,
    configurePreviewServer: start,
    closeBundle: stop,
  };
}
