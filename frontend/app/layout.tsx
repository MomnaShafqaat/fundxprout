import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ThemeProvider from "@/components/theme-provider";
import { AuthProvider } from "@/context/auth-context";
import { Toaster } from "@/components/ui/Toaster";
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
  title: "FundXProut – Blockchain Crowdfunding",
  description:
    "The decentralised crowdfunding platform powered by MetaMask. Launch campaigns, back ideas, and move money at the speed of Web3.",
  keywords: [
    "crowdfunding",
    "blockchain",
    "MetaMask",
    "Web3",
    "fundraising",
    "crypto",
  ],
  authors: [{ name: "FundXProut" }],
  openGraph: {
    title: "FundXProut – Blockchain Crowdfunding",
    description:
      "Launch campaigns and back ideas on the decentralised crowdfunding platform.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0d1221] text-white min-h-screen`}
        suppressHydrationWarning
      >
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}