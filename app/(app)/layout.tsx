import BottomBar from "@/components/shared/BottomBar";
import Sidebar from "@/components/shared/Sidebar";
import { BalanceProvider } from "@/providers/BalanceProvider";
import SolProvider from "@/providers/SolProvider";
import AppLayoutInner from "./AppLayoutInner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BalanceProvider>
      <SolProvider>
        <div className="relative w-full min-h-[100dvh] overflow-x-hidden">
          <Sidebar />

          <AppLayoutInner>
            {/* content padding: keep space for BottomBar */}
            <div className="py-1 pb-28 sm:px-5 lg:px-8 md:ml-18 lg:ml-22">
              {children}
            </div>
          </AppLayoutInner>

          <BottomBar />
        </div>
      </SolProvider>
    </BalanceProvider>
  );
}
