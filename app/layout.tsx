import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
export const metadata: Metadata = {
  title: "AEGIS — The autonomous defense room",
  description:
    "A living cyber range. Watch an AI defense team detect, reason, contain, and learn from simulated attacks.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
