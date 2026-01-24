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

  title: "Haven Vaults",
  description: "Best app for financial growth.",
  manifest: "/manifest.json",
  themeColor: "#02010a",

  openGraph: {
    title: "Haven Vaults",
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

  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Haven",
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
};

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-heading" });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* iOS PWA extras */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Haven" />
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
        <meta name="format-detection" content="telephone=no" />
      </head>

      <body
        suppressHydrationWarning
        className={[
          inter.variable,
          dmSans.variable,
          "bg-background text-foreground antialiased",
        ].join(" ")}
      >
        <ThemeProvider>
          <PrivyProviders>
            <UserProvider>
              <PwaRegister />
              <div
                id="app"
                className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden"
                style={{
                  paddingTop: "env(safe-area-inset-top)",
                  paddingBottom: "env(safe-area-inset-bottom)",
                  paddingLeft: "env(safe-area-inset-left)",
                  paddingRight: "env(safe-area-inset-right)",
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
