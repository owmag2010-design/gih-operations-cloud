import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const sans = Instrument_Sans({ variable: "--font-sans", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "GIH Operations Cloud", template: "%s — GIH Operations Cloud" },
  description: "Operations platform for Global Immigration Hub and its partner firms.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-ZA" className={`${sans.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: "gih-toast" }} />
      </body>
    </html>
  );
}
