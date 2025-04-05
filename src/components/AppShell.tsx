"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import { FooterNav } from "@/components/footer-nav";
import frameSdk from "@farcaster/frame-sdk";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [insideFrame, setInsideFrame] = useState(false);

  useEffect(() => {
    const check = async () => {
      const ctx = await frameSdk.context;
      setInsideFrame(!!ctx);
    };
    check();
  }, []);

  return (
    <>
      {insideFrame && <Header />}
      {children}
      {insideFrame && <FooterNav />}
    </>
  );
}
