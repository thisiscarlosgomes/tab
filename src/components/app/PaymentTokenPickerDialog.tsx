"use client";

import { tokenList } from "@/lib/tokens";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export function PaymentTokenPickerDialog({
  open,
  onOpenChange,
  selectedToken,
  onSelect,
  title = "Choose a payment token",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedToken?: string | null;
  onSelect: (tokenName: string) => void;
  title?: string;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="p-4 pb-6 md:max-w-md">
        <ResponsiveDialogHeader className="pb-3 text-center items-center">
          <ResponsiveDialogTitle className="w-full text-lg font-medium text-center text-white">
            {title}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-2">
          {tokenList.map((token) => {
            const isSelected = token.name === selectedToken;
            return (
              <button
                key={token.name}
                onClick={() => {
                  onSelect(token.name);
                  onOpenChange(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-lg transition ${
                  isSelected ? "bg-white/10" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center">
                  <img
                    src={token.icon}
                    className="w-8 h-8 rounded-full mr-4"
                    alt={token.name}
                  />
                  <span className="text-white">{token.name}</span>
                </div>
                {isSelected ? (
                  <span className="text-xs text-primary">Selected</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
