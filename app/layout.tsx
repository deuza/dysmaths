import type { Metadata, Viewport } from "next";
import Script from "next/script";
import {PwaRegistration} from "@/components/pwa-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dysmaths",
  description: "Multilingual math writing workspace.",
  manifest: "/manifest.webmanifest",
  applicationName: "Dysmaths",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Dysmaths"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  themeColor: "#1f2d3d"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegistration />
        <Script
          defer
          src="https://umami.champeau.info/script.js"
          data-website-id="5fb50e68-45bd-4a02-8da5-ffe741541fe3"
        />
      </body>
    </html>
  );
}
