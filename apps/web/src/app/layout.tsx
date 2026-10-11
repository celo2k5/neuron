import type { Metadata, Viewport } from "next";
import { Doto, Martian_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BootLoader } from "@/components/BootLoader";
import { themeBootScript } from "@/lib/client/theme";

const doto = Doto({ subsets: ["latin"], weight: ["600", "800", "900"], variable: "--font-doto", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], axes: ["wdth"], variable: "--font-martian", display: "swap" });

export const metadata: Metadata = {
  title: { default: "NEURON — One Token. Infinite Connections.", template: "%s · NEURON" },
  description: "A Solana-powered laboratory: generate neural models, run real computations, watch activations propagate, and commit reproducible experiment hashes on-chain.",
};
export const viewport: Viewport = { themeColor: "#080B12", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="obsidian" className={`${doto.variable} ${martian.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
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
