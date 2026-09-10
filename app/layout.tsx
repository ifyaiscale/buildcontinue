import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Limitless Checkout · Your brands, connected",
  description:
    "A considered checkout experience. One workspace for all your brands, Shopify stores, and Whop connections.",
  robots: { index: false, follow: false },
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
