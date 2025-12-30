"use client";

import React, { useState } from "react";

import HoldingsTable from "@/components/invest/HoldingsTable";
import SellDrawer from "@/components/invest/Sell";
import TransferSPL from "@/components/invest/TransferSPL";
import Receive from "@/components/invest/Receive";

import { Drawer } from "@/components/ui/drawer";
import { useUser } from "@/providers/UserProvider";

const Invest: React.FC = () => {
  const [sellOpen, setSellOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

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
              onReceive={() => {
                if (!walletAddress) return;
                setReceiveOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      {/* Sell modal (Dialog inside Sell.tsx) */}
      <SellDrawer open={sellOpen} onOpenChange={setSellOpen} />

      {/* ✅ Transfer modal (Dialog inside TransferSPL.tsx) */}
      {walletAddress && (
        <TransferSPL
          open={transferOpen}
          onOpenChange={setTransferOpen}
          walletAddress={walletAddress}
          onSuccess={() => setTransferOpen(false)}
        />
      )}

      {/* ✅ Receive drawer (parent owns Drawer; Receive is DrawerContent) */}
      {walletAddress && (
        <Drawer open={receiveOpen} onOpenChange={setReceiveOpen}>
          <Receive
            walletAddress={walletAddress}
            onSuccess={() => setReceiveOpen(false)}
          />
        </Drawer>
      )}
    </>
  );
};

export default Invest;
