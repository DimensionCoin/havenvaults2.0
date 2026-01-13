// app/(app)/layout.tsx
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
            
            <div className="py-1 pb-24 sm:px-5 lg:px-8 md:ml-18 lg:ml-22 md:pb-4">
              {children}
            </div>
          </AppLayoutInner>

          <BottomBar />
        </div>
      </SolProvider>
    </BalanceProvider>
  );
}
