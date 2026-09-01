import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(resolve(process.env.APP_DATA_DIR || join(rootDir, "data")), "cases.sqlite");
const backupDir = resolve(process.env.APP_BACKUP_DIR || join(rootDir, "backups"));

if (!existsSync(sourcePath)) {
  console.error("尚未找到資料庫。請先啟動並使用系統，再執行備份。");
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
const destination = join(backupDir, `案件管理系統備份-${stamp}.sqlite`);
const database = new DatabaseSync(sourcePath, { readOnly: true });

try {
  await backup(database, destination);
  console.log(`備份完成：${destination}`);
} finally {
  database.close();
}
