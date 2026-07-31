import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://company-registration-tw-preview.yencheng-lin-2481.chatgpt.site"),
  title: "公司設立登記智慧精靈",
  description: "集中管理公司設立案件、應備資料、文件產出與每月工商統計。",
  openGraph: {
    title: "公司設立登記智慧精靈",
    description: "案件追蹤・文件產出・每月統計",
    images: [{ url: "/og.png", width: 1536, height: 1024 }],
    type: "website",
    locale: "zh_TW",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
