"use client";

import * as React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/cn";

type Mode = "desktop" | "mobile";

const ResponsiveDialogModeContext = React.createContext<Mode>("desktop");

function useResponsiveDialogMode() {
  return React.useContext(ResponsiveDialogModeContext);
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

type RootProps = {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  repositionInputs?: boolean;
};

function ResponsiveDialog({ children, ...props }: RootProps) {
  const isDesktop = useIsDesktop();
  const mode: Mode = isDesktop ? "desktop" : "mobile";
  const { repositionInputs, ...sharedProps } = props;

  const shell = isDesktop ? (
    <Dialog {...sharedProps}>{children}</Dialog>
  ) : (
    <Drawer {...sharedProps} repositionInputs={repositionInputs}>{children}</Drawer>
  );

  return (
    <ResponsiveDialogModeContext.Provider value={mode}>
      {shell}
    </ResponsiveDialogModeContext.Provider>
  );
}

function ResponsiveDialogTrigger(
  props: React.ComponentPropsWithoutRef<typeof DialogTrigger>
) {
  const mode = useResponsiveDialogMode();
  if (mode === "desktop") return <DialogTrigger {...props} />;
  return <DrawerTrigger {...props} />;
}

function ResponsiveDialogClose(
  props: React.ComponentPropsWithoutRef<typeof DialogClose>
) {
  const mode = useResponsiveDialogMode();
  if (mode === "desktop") return <DialogClose {...props} />;
  return <DrawerClose {...props} />;
}

function ResponsiveDialogContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const mode = useResponsiveDialogMode();

  if (mode === "desktop") {
    return (
      <DialogContent className={cn("max-h-[85vh] overflow-y-auto", className)} {...props}>
        {children}
      </DialogContent>
    );
  }

  return (
    <DrawerContent
      className={cn(
        "top-[40px] bottom-0 min-h-[calc(100dvh-40px)] max-h-[calc(100dvh-40px)] overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </DrawerContent>
  );
}

function ResponsiveDialogHeader(
  props: React.HTMLAttributes<HTMLDivElement>
) {
  const mode = useResponsiveDialogMode();
  if (mode === "desktop") return <DialogHeader {...props} />;
  return <DrawerHeader {...props} />;
}

function ResponsiveDialogFooter(
  props: React.HTMLAttributes<HTMLDivElement>
) {
  const mode = useResponsiveDialogMode();
  if (mode === "desktop") return <DialogFooter {...props} />;
  return <DrawerFooter {...props} />;
}

function ResponsiveDialogTitle(
  props: React.ComponentPropsWithoutRef<typeof DialogTitle>
) {
  const mode = useResponsiveDialogMode();
  if (mode === "desktop") return <DialogTitle {...props} />;
  return <DrawerTitle {...props} />;
}

function ResponsiveDialogDescription(
  props: React.ComponentPropsWithoutRef<typeof DialogDescription>
) {
  const mode = useResponsiveDialogMode();
  if (mode === "desktop") return <DialogDescription {...props} />;
  return <DrawerDescription {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
};
