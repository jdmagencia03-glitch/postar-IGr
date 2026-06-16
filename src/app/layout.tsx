import type { Metadata } from "next";
import { Grand_Hotel } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const instagramBrand = Grand_Hotel({
  variable: "--font-instagram-brand",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: {
    default: "PostariGr",
    template: "%s · PostariGr",
  },
  description:
    "Agende Reels e posts no Instagram com IA — legendas, hashtags e horários automáticos",
  applicationName: "PostariGr",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${instagramBrand.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
