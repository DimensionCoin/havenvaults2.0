import AmplifyClient from "./AmplifyClient";

export type AmplifyTab = "multiplier" | "bundles" | "robo" | "predict";
const DEFAULT_TAB: AmplifyTab = "bundles";

function isAmplifyTab(v: unknown): v is AmplifyTab {
  return (
    v === "multiplier" || v === "bundles" || v === "robo" || v === "predict"
  );
}

export default async function Page({
  searchParams,
}: {
  // ✅ in your Next version, searchParams is async
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;

  const initialTab: AmplifyTab = isAmplifyTab(sp?.tab) ? sp.tab : DEFAULT_TAB;

  return <AmplifyClient  />;
}
