// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

import PrivyProviders from "@/providers/PrivyProvider";
import { Inter, DM_Sans } from "next/font/google";
import { UserProvider } from "@/providers/UserProvider";
import PwaRegister from "@/components/PwaRegister";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";
import ThemeProvider from "@/providers/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://havenfinancial.xyz"),
  title: {
    default: "Haven Financial | Fun Investing & High-Yield Savings",
    template: "%s | Haven Financial",
  },
  description:
    "Haven Financial is a new, fun investment and high-yield savings platform with financial tools to help you grow wealth over time. Wealth isn't made overnight - it's built step by step.",
  keywords: [
    "Haven Financial",
    "Haven Vaults",
    "high-yield savings",
    "investing app",
    "wealth growth",
    "financial tools",
    "savings platform",
  ],
  applicationName: "Haven Financial",
  category: "finance",
  manifest: "/manifest.json",

  // ✅ IMPORTANT: remove themeColor from metadata (Next warns here)
  // themeColor belongs in `export const viewport` below.

  openGraph: {
    title: "Haven Financial | Fun Investing & High-Yield Savings",
    description:
      "Haven Financial is a new, fun investment and high-yield savings platform with financial tools to help you grow wealth over time.",
    url: "https://havenfinancial.xyz",
    siteName: "Haven Financial",
    images: [
      {
        url: "https://havenfinancial.xyz/twitter.png",
        width: 1200,
        height: 630,
        alt: "Haven Financial",
      },
    ],
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "Haven Financial | Fun Investing & High-Yield Savings",
    description:
      "A new, fun investment and high-yield savings platform with tools to help you grow wealth over time.",
    images: ["https://havenfinancial.xyz/twitter.png"],
  },

  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Haven",
  },

  other: {
    "mobile-web-app-capable": "yes",
  },
  alternates: {
    canonical: "/",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",

  // ✅ Put themeColor here to remove the warning
  themeColor: "#02010a",
};

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-heading" });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "FinancialService",
    name: "Haven Financial",
    url: "https://havenfinancial.xyz",
    description:
      "A new, fun investment and high-yield savings platform with financial tools to help people grow wealth over time.",
    logo: "https://havenfinancial.xyz/logo.jpg",
  };

  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Haven Financial",
    url: "https://havenfinancial.xyz",
  };

  return (
    <html lang="en" suppressHydrationWarning>
      {/* ✅ Keep head clean: only things Next doesn’t already output */}
      <head>
        <meta name="format-detection" content="telephone=no" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
      </head>

      <body
        suppressHydrationWarning
        className={[
          inter.variable,
          dmSans.variable,
          "min-h-[100dvh] bg-background text-foreground antialiased",
          "overflow-hidden",
        ].join(" ")}
      >
        <ThemeProvider>
          <PrivyProviders>
            <UserProvider>
              <ConvexClientProvider>
                <PwaRegister />

                {/* App shell scroll container */}
                <div
                  id="app"
                  className="h-[100dvh] w-full overflow-y-auto overscroll-contain overflow-x-hidden"
                  style={{
                    paddingTop: "env(safe-area-inset-top)",
                    paddingBottom: "0px",
                    paddingLeft: "env(safe-area-inset-left)",
                    paddingRight: "env(safe-area-inset-right)",
                  }}
                >
                  {children}
                </div>
              </ConvexClientProvider>
            </UserProvider>
          </PrivyProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
