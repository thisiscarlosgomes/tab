"use client";

import { useState, useCallback } from "react";
import QRCodeScanner from "./QRCodeScanner";
import SendToUserForm from "./SendToUserForm";
import PaymentSuccessScreen from "./PaymentSuccessScreen";

type View = "scanner" | "form" | "success";

type FarcasterUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  verified_addresses?: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

export default function QRCodeSendFlow() {
  const [view, setView] = useState<View>("scanner");

  const [user, setUser] = useState<FarcasterUser | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleValidScan = useCallback((scannedUser: FarcasterUser) => {
    setUser(scannedUser);
    setView("form");
  }, []);

  const handlePaymentSuccess = useCallback((hash: string) => {
    setTxHash(hash);
    setView("success");
  }, []);

  const resetFlow = useCallback(() => {
    setView("scanner");
    setUser(null);
    setTxHash(null);
  }, []);

  if (view === "scanner") {
    return <QRCodeScanner onValidUser={handleValidScan} />;
  }

  if (view === "form" && user) {
    return (
      <SendToUserForm
        user={user}
        onCancel={resetFlow}
        onSuccess={handlePaymentSuccess}
      />
    );
  }

  if (view === "success" && txHash && user) {
    return (
      <PaymentSuccessScreen
        txHash={txHash}
        recipientUsername={user.username}
        onDone={resetFlow}
      />
    );
  }

  return null;
}
