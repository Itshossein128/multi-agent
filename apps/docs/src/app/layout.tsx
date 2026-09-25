import type { Metadata } from "next";
import "./globals.css";
import { DocsShell } from "@/components/DocsShell";

export const metadata: Metadata = {
  title: {
    default: "Multi-Agent Studio Docs",
    template: "%s · Multi-Agent Studio Docs",
  },
  description: "Architecture, security, development and operations documentation for Multi-Agent Studio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <DocsShell>{children}</DocsShell>
      </body>
    </html>
  );
}
