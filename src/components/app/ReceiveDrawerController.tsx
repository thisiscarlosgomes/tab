"use client";

import { ReactNode, useCallback, useState } from "react";
import { ReceiveDrawer } from "@/components/app/ReceiveDrawer";

type ReceiveDrawerControllerProps = {
  children: (controls: { openReceiveDrawer: () => void }) => ReactNode;
};

export function ReceiveDrawerController({
  children,
}: ReceiveDrawerControllerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const openReceiveDrawer = useCallback(() => {
    setIsOpen(true);
  }, []);

  return (
    <>
      {children({ openReceiveDrawer })}
      <ReceiveDrawer isOpen={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}

