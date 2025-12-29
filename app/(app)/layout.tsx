import BottomBar from "@/components/shared/BottomBar";
import Sidebar from "@/components/shared/Sidebar";
import { BalanceProvider } from "@/providers/BalanceProvider";
import SolProvider from "@/providers/SolProvider";

export default function appLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <BalanceProvider>
      <SolProvider>
        <div className="w-full min-h-screen">
          {" "}
          <Sidebar />
          <div className="py-1  md:justify-center items-center md:ml-18 lg:ml-22 pb-20 sm:px-5 lg:px-8">
            {children}
          </div>
          <BottomBar />
        </div>
      </SolProvider>
    </BalanceProvider>
  );
}
