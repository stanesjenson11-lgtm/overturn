import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeaseLens — ask your lease what it actually says",
  description:
    "Upload a lease. Every answer quotes the governing clause and cites the page — and says so when the lease doesn't cover it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
