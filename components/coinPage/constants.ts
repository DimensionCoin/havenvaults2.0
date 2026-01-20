import type { TimeframeKey, StageConfig } from "./types";
import type { UsdcSwapStatus } from "@/hooks/useServerSponsoredUsdcSwap";

export const SWAP_FEE_PCT =
  Number(process.env.NEXT_PUBLIC_CRYPTO_SWAP_FEE_UI ?? "0") || 0;

export const SWAP_FEE_PCT_DISPLAY = SWAP_FEE_PCT * 100;

export const TIMEFRAMES: Record<TimeframeKey, { label: string; days: string }> =
  {
    "1D": { label: "24H", days: "1" },
    "7D": { label: "7D", days: "7" },
    "30D": { label: "30D", days: "30" },
    "90D": { label: "90D", days: "90" },
  };

export const STAGE_CONFIG: Record<UsdcSwapStatus, StageConfig> = {
  idle: {
    title: "",
    subtitle: "",
    progress: 0,
    icon: "spinner",
  },
  building: {
    title: "Preparing order",
    subtitle: "Finding best route...",
    progress: 15,
    icon: "spinner",
  },
  signing: {
    title: "Approving the transaction",
    subtitle: "approving the order with exchange",
    progress: 30,
    icon: "wallet",
  },
  sending: {
    title: "Submitting",
    subtitle: "Broadcasting to network...",
    progress: 60,
    icon: "spinner",
  },
  confirming: {
    title: "Confirming",
    subtitle: "Waiting for network...",
    progress: 85,
    icon: "spinner",
  },
  done: {
    title: "Order complete!",
    subtitle: "Your trade was successful",
    progress: 100,
    icon: "success",
  },
  error: {
    title: "Order failed",
    subtitle: "Something went wrong",
    progress: 0,
    icon: "error",
  },
};
