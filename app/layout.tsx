// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import PrivyProviders from "@/providers/PrivyProvider";
import { Inter, DM_Sans } from "next/font/google";
import { UserProvider } from "@/providers/UserProvider";

export const metadata: Metadata = {
  title: "Haven Vaults",
  description: "Best app for financial growth.",
};

// Professional, readable UI font
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

// Friendly but clean heading font
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`
          ${inter.variable}
          ${dmSans.variable}
          min-h-screen
          bg-background
          text-foreground
          antialiased
        `}
      >
        <PrivyProviders>
          <UserProvider>{children}</UserProvider>
        </PrivyProviders>
      </body>
    </html>
  );
}
