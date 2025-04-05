"use client";

import { ReactNode, useState } from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";

type DrawerCardProps = {
  trigger: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  closeText?: string;
};

export function DrawerCard({
  trigger,
  title,
  description,
  children,
  closeText = "Continue",
}: DrawerCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
        <Drawer.Content className="pb-6 z-30 bg-background flex flex-col rounded-t-[32px] mt-24 h-fit fixed bottom-0 left-0 right-0 outline-none">
          
          
          
          <div className="mt-3 mx-auto w-10 h-1.5 rounded-full bg-white/10 mb-4" />
          <div className="px-6 flex justify-between items-start">
          <Drawer.Title className="hidden">{title}</Drawer.Title>
            <div>
              <h2 className="text-xl font-medium">{title}</h2>
              {description && (
                <p className="text-white/50 text-base">{description}</p>
              )}
            </div>
          </div>

          <div className="p-6 text-white/30 font-medium">{children}</div>

          <div className="px-6 pb-4">
            <Button
              onClick={() => setOpen(false)}
              className="w-full bg-primary"
            >
              {closeText}
            </Button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
