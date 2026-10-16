import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trippie — Cheapest Flight Windows",
  description:
    "Pick a month and trip length; find the cheapest round-trip dates or one-way fares across Indian routes.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef3fb" },
    { media: "(prefers-color-scheme: dark)", color: "#070b16" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col relative selection:bg-sky-500/20">
        <div className="bg-mesh" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
