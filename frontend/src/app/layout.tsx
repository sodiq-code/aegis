import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aegis — Institutional Treasury Layer on Flare",
  description: "A verifiable, confidential, AI-managed cross-chain treasury and autonomous risk layer for XRP-native institutions on Flare. Uses FAssets, FTSO V2, FDC, FCC, and PMW.",
  keywords: ["Aegis", "Flare", "FAssets", "FXRP", "FTSO", "FDC", "FCC", "PMW", "institutional treasury", "XRP", "cross-chain", "solvency"],
  authors: [{ name: "Aegis Team" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Aegis — Institutional Treasury Layer on Flare",
    description: "Verifiable, confidential, AI-managed cross-chain treasury for XRP-native institutions",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
