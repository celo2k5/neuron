import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BootLoader } from "@/components/BootLoader";
import { themeBootScript } from "@/lib/client/theme";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-newsreader", display: "swap" });

const DESCRIPTION = "A laboratory for neural computation you can see and check: generate neural models from seeds, run real inference, watch activations propagate, train, and record reproducible experiments.";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://neuronai.online"),
  title: { default: "Neuron — Intelligence is a network.", template: "%s · Neuron" },
  description: DESCRIPTION,
  applicationName: "Neuron",
  openGraph: { type: "website", siteName: "Neuron", title: "Neuron — Intelligence is a network.", description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: "Neuron — Intelligence is a network.", description: DESCRIPTION },
};
export const viewport: Viewport = { themeColor: "#080B12", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="obsidian" className={`${geist.variable} ${geistMono.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="grain">
        <Providers>
          <BootLoader />
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 bg-bg px-2 py-1">Skip to content</a>
          <Header />
          <main id="main" className="min-h-[calc(100vh-120px)]">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
