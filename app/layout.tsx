import type { Metadata, Viewport } from "next";
import Script from "next/script";
import {getLocale} from "next-intl/server";
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

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const umamiSrc = process.env.NEXT_PUBLIC_UMAMI_SRC;
  const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const enableAnalytics =
    process.env.NODE_ENV === "production" && umamiSrc && umamiWebsiteId;

  return (
    <html lang={locale}>
      <body>
        {children}
        <PwaRegistration />
        {enableAnalytics ? (
          <Script
            defer
            src={umamiSrc}
            data-website-id={umamiWebsiteId}
          />
        ) : null}
      </body>
    </html>
  );
}
