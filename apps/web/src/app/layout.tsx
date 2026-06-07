import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodexNext",
  description: "Your personal Codex control plane."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
