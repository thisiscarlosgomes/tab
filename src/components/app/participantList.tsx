// components/app/participantList.tsx
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { shortAddress } from "@/lib/shortAddress";
import { BellRing } from "lucide-react";

interface Participant {
  name: string;
  address: string;
  pfp?: string;
  fid?: string;
}

interface ParticipantListProps {
  participants: Participant[];
  adminAddress: string;
  isAdmin?: boolean;
  onNotify?: (fid: string) => void;
}

export function ParticipantList({
  participants,
  adminAddress,
  isAdmin,
  onNotify,
}: ParticipantListProps) {
  return (
    <div className="border rounded-lg p-4">
      <h2 className="text-md font-medium mb-2">Members</h2>
      <ul className="space-y-2">
        {participants.map((p) => (
          <li
            key={p.address}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7 bg-secondary rounded-full">
                <AvatarImage
                  src={
                    p.pfp ||
                    `https://api.dicebear.com/9.x/glass/svg?seed=${p.name}`
                  }
                  alt={p.name}
                  width={24}
                  height={24}
                />
              </Avatar>
              <div>
                <p className="text-sm font-medium flex items-center gap-1">
                  @{p.name}
                  {p.address.toLowerCase() === adminAddress.toLowerCase() && (
                    <span className="text-xs text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded-md">
                      admin
                    </span>
                  )}
                </p>
                <p className="text-sm opacity-30">{shortAddress(p.address)}</p>
              </div>
            </div>

            {isAdmin && p.fid && p.address.toLowerCase() !== adminAddress.toLowerCase() && (
              <button
                onClick={() => onNotify?.(p.fid!)}
                className="p-1 rounded-full hover:bg-white/10"
              >
                <BellRing className="w-4 h-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
