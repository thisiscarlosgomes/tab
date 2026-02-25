"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

type BaseFriend = {
  fid: number;
  username: string;
  pfp_url?: string;
};

type FriendsPickerDialogProps<T extends BaseFriend> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onPaste?: () => void | Promise<void>;
  users: T[];
  selectedUsers: T[];
  onToggleUser: (user: T) => void;
  onDone: () => void;
  loading?: boolean;
  searching?: boolean;
  title?: string;
  isUserDisabled?: (user: T) => boolean;
  disabledLabel?: string;
};

export function FriendsPickerDialog<T extends BaseFriend>({
  open,
  onOpenChange,
  query,
  onQueryChange,
  onPaste,
  users,
  selectedUsers,
  onToggleUser,
  onDone,
  loading = false,
  searching = false,
  title = "Choose friends",
  isUserDisabled,
  disabledLabel = "No linked wallet",
}: FriendsPickerDialogProps<T>) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="top-auto h-auto min-h-[520px] max-h-[calc(100dvh-80px)] p-4 pb-6 md:top-1/2 md:-translate-y-1/2 md:max-w-md md:min-h-[520px] md:max-h-[70vh] flex flex-col">
        <ResponsiveDialogTitle className="text-center text-lg">
          {title}
        </ResponsiveDialogTitle>

        <div className="mt-4">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search by username"
              className="w-full rounded-lg bg-white/5 p-3 pr-16 text-white placeholder-white/20"
            />
            {query ? (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-primary"
                onClick={() => onQueryChange("")}
              >
                Clear
              </button>
            ) : (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-primary"
                onClick={() => void onPaste?.()}
              >
                Paste
              </button>
            )}
          </div>
        </div>

        {selectedUsers.length > 0 && (
          <div className="mt-4 shrink-0">
            <div className="rounded-lg bg-white/5 px-4 py-3">
              <div className="flex flex-wrap gap-3">
                {selectedUsers.map((u) => (
                  <div key={`selected-${u.fid}`} className="relative h-[72px] w-12">
                    <img
                      src={
                        u.pfp_url ||
                        `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${u.username}`
                      }
                      alt={u.username}
                      className="h-12 w-12 rounded-full border-2 border-white/5 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => onToggleUser(u)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background text-white"
                    >
                      ×
                    </button>
                    <span className="mt-1 block w-12 truncate text-center text-xs text-white">
                      @{u.username}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex-1 min-h-0 overflow-y-auto space-y-2">
          {searching && users.length === 0 ? (
            Array.from({ length: 5 }).map((_, idx) => (
              <div
                key={`friends-skel-${idx}`}
                className="w-full rounded-lg p-3 bg-white/5 flex items-center gap-3 animate-pulse"
              >
                <div className="h-10 w-10 rounded-full bg-white/10 shrink-0" />
                <div className="h-5 w-40 rounded bg-white/10" />
              </div>
            ))
          ) : loading && users.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">Loading friends…</div>
          ) : users.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">No results</div>
          ) : (
            users.map((u) => {
              const isSelected = selectedUsers.some((x) => x.fid === u.fid);
              const disabled = Boolean(isUserDisabled?.(u));
              return (
                <button
                  key={u.fid}
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleUser(u)}
                  className={`w-full rounded-lg p-3 flex items-center justify-between text-left ${
                    disabled ? "bg-white/[0.03] opacity-60 cursor-not-allowed" : "bg-white/5"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={
                        u.pfp_url ||
                        `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${u.username}`
                      }
                      alt={u.username}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-white">@{u.username}</div>
                      {disabled ? (
                        <div className="text-xs text-white/40">{disabledLabel}</div>
                      ) : null}
                    </div>
                  </div>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      isSelected && !disabled ? "border-primary bg-primary" : "border-white/10"
                    }`}
                  >
                    {isSelected && !disabled ? <Check className="h-4 w-4 text-black" /> : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <Button className="mt-4 w-full bg-primary" onClick={onDone}>
          Done
        </Button>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

