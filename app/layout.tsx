import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dysmaths - l'écriture mathématique facile pour les dysgraphiques et dyspraxiques",
  description:
    "Une application Next.js pensée pour permettre aux collégiens et lycéens de rédiger, sauvegarder et imprimer leurs formules mathématiques."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>
        {children}
        <Script
          defer
          src="https://umami.champeau.info/script.js"
          data-website-id="5fb50e68-45bd-4a02-8da5-ffe741541fe3"
        />
      </body>
    </html>
  );
}
