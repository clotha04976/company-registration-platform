import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "工商登記案件平台｜設立登記預覽",
  description: "公司設立登記案件的收件、資料映射與文件產出預覽。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
