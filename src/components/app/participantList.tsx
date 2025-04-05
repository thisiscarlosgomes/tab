import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { shortAddress } from "@/lib/shortAddress";

interface Participant {
  name: string;
  address: string;
  pfp?: string;
  fid?: string;
}

interface ParticipantListProps {
  participants: Participant[];
  adminAddress: string;
}

export function ParticipantList({
  participants,
  adminAddress,
}: ParticipantListProps) {
  return (
    <div className="border rounded-lg p-4">
      <h2 className="text-md font-medium mb-2">In this Table</h2>
      <ul className="space-y-2">
        {participants.map((p) => (
          <li
            key={p.address}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6 bg-secondary rounded-full">
                <AvatarImage
                  src={
                    p.pfp ||
                    `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${p.name}`
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
          </li>
        ))}
      </ul>
    </div>
  );
}
