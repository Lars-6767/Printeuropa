import type { Metadata, Viewport } from "next";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/red-hat-display";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Mijn Bereyl", template: "%s · Mijn Bereyl" },
  description: "Meld je aan bij Bereyl: ontdek welke box bij jullie past, bekijk je prijs en regel de plaatsing.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F2F0E8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
