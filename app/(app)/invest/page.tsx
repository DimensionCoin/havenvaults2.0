// app/invest/page.tsx (or wherever this file lives)
"use client";

import React, { useState } from "react";

import HoldingsTable from "@/components/invest/HoldingsTable";
import OpenPositionsMini from "@/components/invest/OpenPositionsMini";
import SellDrawer from "@/components/invest/Sell";
import TransferSPL from "@/components/invest/TransferSPL";

import { useUser } from "@/providers/UserProvider";

const Invest: React.FC = () => {
  const [sellOpen, setSellOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const { user } = useUser();
  const walletAddress = user?.walletAddress || "";

  return (
    <>
      <div className="min-h-screen text-foreground">
        <div className="mx-auto w-full max-w-4xl px-3 pb-10 pt-4 sm:px-4">
          <div className="glass-panel bg-white/10 p-4 sm:p-5">
            <HoldingsTable
              onSell={() => setSellOpen(true)}
              onSend={() => {
                if (!walletAddress) return;
                setTransferOpen(true);
              }}
            />

            {/* ✅ Small clean positions list under token holdings */}
            <OpenPositionsMini />
          </div>
        </div>
      </div>

      <SellDrawer open={sellOpen} onOpenChange={setSellOpen} />

      {walletAddress && (
        <TransferSPL
          open={transferOpen}
          onOpenChange={setTransferOpen}
          walletAddress={walletAddress}
          onSuccess={() => setTransferOpen(false)}
        />
      )}
    </>
  );
};

export default Invest;
