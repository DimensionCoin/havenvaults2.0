import type { Metadata } from "next";
import type { Viewport } from "next";
import "./globals.css";

import PrivyProviders from "@/providers/PrivyProvider";
import { Inter, DM_Sans } from "next/font/google";
import { UserProvider } from "@/providers/UserProvider";
import PwaRegister from "@/components/PwaRegister";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";
import ThemeProvider from "@/providers/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://havenfinancial.xyz"),

  title: "Haven Financial",
  description: "Best app for financial growth.",
  manifest: "/manifest.json",

  applicationName: "Haven",

  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Haven",
    startupImage: [
      // iPhone 15 Pro Max, 14 Pro Max
      {
        url: "/splash/apple-splash-1290-2796.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)",
      },
      // iPhone 15 Pro, 14 Pro, 13 Pro
      {
        url: "/splash/apple-splash-1179-2556.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)",
      },
      // iPhone 15, 14, 13
      {
        url: "/splash/apple-splash-1170-2532.png",
        media:
          "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)",
      },
      // iPhone 11 Pro Max, XS Max
      {
        url: "/splash/apple-splash-1242-2688.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)",
      },
    ],
  },

  icons: {
    apple: [
      { url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },

  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#02010a" },
    { media: "(prefers-color-scheme: dark)", color: "#02010a" },
  ],

  openGraph: {
    title: "Haven Financial",
    description: "Best app for financial growth.",
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
    title: "Haven Financial",
    description: "Best app for financial growth.",
    images: ["https://havenfinancial.xyz/twitter.png"],
  },

  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#02010a",
  colorScheme: "dark",
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Critical iOS PWA meta tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Haven" />

        {/* Apple touch icons */}
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <link
          rel="apple-touch-icon"
          sizes="152x152"
          href="/icons/icon-152.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="167x167"
          href="/icons/icon-167.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/icons/icon-180.png"
        />

        {/* Disable iOS features that break app feel */}
        <meta name="format-detection" content="telephone=no" />

        {/* Android PWA */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#02010a" />

        {/* Prevent text size adjustment */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
      </head>

      <body
        suppressHydrationWarning
        className={[
          inter.variable,
          dmSans.variable,
          "min-h-[100dvh] bg-background text-foreground antialiased",
          "overflow-hidden",
          "touch-pan-y", // Better touch handling
          "select-none", // Prevent text selection for app-like feel
        ].join(" ")}
        style={{
          // Prevent pull-to-refresh on mobile
          overscrollBehavior: "none",
          // Improve tap responsiveness
          WebkitTapHighlightColor: "transparent",
          // Prevent rubber banding
          position: "fixed",
          width: "100%",
          height: "100%",
        }}
      >
        <ThemeProvider>
          <PrivyProviders>
            <UserProvider>
              <PwaRegister />
              <div
                id="app"
                className="h-full w-full overflow-y-auto overscroll-contain"
                style={{
                  // Safe area insets for notch/island
                  paddingTop: "env(safe-area-inset-top)",
                  paddingBottom: "env(safe-area-inset-bottom)",
                  paddingLeft: "env(safe-area-inset-left)",
                  paddingRight: "env(safe-area-inset-right)",
                  // Smooth scrolling
                  WebkitOverflowScrolling: "touch",
                  // Prevent overscroll
                  overscrollBehavior: "contain",
                }}
              >
                <ConvexClientProvider>{children}</ConvexClientProvider>
              </div>
            </UserProvider>
          </PrivyProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
