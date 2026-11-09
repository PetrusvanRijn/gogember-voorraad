import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Voorraad · Go Gember",
  description: "Voorraad en dagen dekking voor Go Gember, fulfilment door Brandhouse Partners.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className={`${inter.className} ${inter.variable}`}>{children}</body>
    </html>
  );
}
