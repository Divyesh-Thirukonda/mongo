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
    // Browser extensions can add attributes to this root before React hydrates.
    // Suppression is limited to this element; child hydration checks stay active.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
