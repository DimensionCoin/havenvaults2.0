//app/providers/ThemeProvider.tsx
"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class" // adds/removes .dark on <html>
      defaultTheme="dark" // Haven defaults to dark
      enableSystem={true} // allow system theme
      disableTransitionOnChange // avoids flicker
    >
      {children}
    </NextThemesProvider>
  );
}