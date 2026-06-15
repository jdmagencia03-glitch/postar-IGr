import type { Metadata } from "next";
import { Grand_Hotel } from "next/font/google";
import "./globals.css";

const instagramBrand = Grand_Hotel({
  variable: "--font-instagram-brand",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "InstaScheduler — Agende posts no Instagram",
  description: "Agende Reels, Feed e Carrosséis via API oficial da Meta",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${instagramBrand.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
