import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Converge — One shared direction",
  description: "A collaborative coding workspace. Bring different perspectives into one shared agent session.",
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
