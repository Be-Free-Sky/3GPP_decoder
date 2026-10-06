import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/app/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Skyworth 3GPP Decoder",
  description:
    "Decode LTE and 5G NR RRC, NAS and S1AP / NGAP hex from Logel logs into readable messages with root cause analysis.",
};

export const viewport: Viewport = {
  themeColor: "#f2f6fa",
  colorScheme: "light",
};

// Opening out/index.html straight from disk (file://) cannot work: assets use absolute
// paths and browsers block the decoder's Web Worker there. Explain what to do instead.
const FILE_NOTICE = `
if (location.protocol === "file:") {
  document.addEventListener("DOMContentLoaded", function () {
    document.body.innerHTML =
      '<div style="font-family:Segoe UI,system-ui,sans-serif;max-width:620px;margin:12vh auto;padding:32px;border-radius:16px;' +
      'background:#fff;border:1px solid rgba(0,27,72,.12);box-shadow:0 24px 48px -28px rgba(0,27,72,.45);color:#001b48">' +
      '<div style="height:4px;border-radius:4px;margin:-8px 0 24px;background:linear-gradient(135deg,#001b48,#02457a 52%,#018abe)"></div>' +
      '<h1 style="margin:0 0 12px;font-size:22px">Open the decoder through a web server</h1>' +
      '<p style="margin:0 0 16px;line-height:1.6;color:#4a6483">This page was opened directly from disk. The decoder runs Python in a background ' +
      'worker, which browsers only allow on pages served over http.</p>' +
      '<p style="margin:0 0 8px;font-weight:600">Pick one:</p>' +
      '<ol style="margin:0;padding-left:20px;line-height:1.9;color:#001b48">' +
      '<li>Double-click <b>open-decoder.cmd</b> in the project folder.</li>' +
      '<li>Or run <code style="background:#eef3f8;padding:2px 6px;border-radius:6px">npm run preview</code> and open ' +
      '<code style="background:#eef3f8;padding:2px 6px;border-radius:6px">http://127.0.0.1:4173</code>.</li>' +
      '<li>Or use the published GitHub Pages link.</li></ol></div>';
    document.body.style.background = "#f2f6fa";
  });
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FILE_NOTICE }} />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
