import type { Metadata } from "next";
import "./globals.css";
import PrivyProviders from "@/providers/PrivyProvider";
import { Inter, DM_Sans } from "next/font/google";
import { UserProvider } from "@/providers/UserProvider";
import PwaRegister from "@/components/PwaRegister";
import { ConvexClientProvider } from "@/providers/ConvexClientProvider";

export const metadata: Metadata = {
  title: "Haven Vaults",
  description: "Best app for financial growth.",
  manifest: "/manifest.webmanifest",
  themeColor: "#000000",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Haven",
  },
};

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-heading" });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* iOS home screen icon (use your best 180x180 if you have it) */}
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        {/* Optional: iOS splash screens are separate (can add later) */}
      </head>

      <body
        className={`${inter.variable} ${dmSans.variable} min-h-screen bg-background text-foreground antialiased`}
      >
        <PrivyProviders>
          <UserProvider>
            <PwaRegister />
            <ConvexClientProvider> {children}</ConvexClientProvider>
          </UserProvider>
        </PrivyProviders>
      </body>
    </html>
  );
}
