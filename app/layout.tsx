import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overturn — check a rejected health insurance claim",
  description:
    "Upload your policy and the rejection letter. Overturn checks the reason against your policy and IRDAI's rules, says plainly whether it holds up, and drafts a cited appeal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
