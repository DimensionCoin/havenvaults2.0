"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type WalletQRCodeProps = {
  value: string;
  size?: number;
};

export function WalletQRCode({ value, size = 140 }: WalletQRCodeProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!value) return;

    const generateQR = async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(value, {
          width: size * 2,
          margin: 1,
          color: { dark: "#000000", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
        setQrDataUrl(dataUrl);
        setError(false);
      } catch (err) {
        console.error("QR generation failed:", err);
        setError(true);
      }
    };

    generateQR();
  }, [value, size]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border bg-muted/20"
        style={{ width: size, height: size }}
      >
        <span className="text-[11px] text-muted-foreground">
          QR unavailable
        </span>
      </div>
    );
  }

  if (!qrDataUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border bg-muted/20"
        style={{ width: size, height: size }}
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={qrDataUrl}
      alt="Wallet QR Code"
      width={size}
      height={size}
      className="rounded-xl"
    />
  );
}
