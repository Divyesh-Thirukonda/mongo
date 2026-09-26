import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Converge — Coding sessions",
  description: "Shared coding sessions with attributed requests, live agent activity, and verified changes.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
