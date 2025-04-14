"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import Image from "next/image";
// import { isFrame } from "@/lib/isFrame"; // ✅
import { DailySpinDrawer } from "@/components/app/DailySpinDrawer";
import { QRCode } from "react-qrcode-logo";
import Tilt from "react-parallax-tilt";
import sdk from "@farcaster/frame-sdk";
// import { useAccount, useConnect } from "wagmi";
// import { injected } from "wagmi/connectors";
import { shortAddress } from "@/lib/shortAddress";
import { useAccount } from "wagmi";
import {
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  parseISO,
} from "date-fns";
import { UserPlus, Plus } from "lucide-react";
import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import { ScanLine, QrCode } from "lucide-react";

type ActivityType =
  | "created"
  | "joined"
  | "paid"
  | "received" // ✅ add this
  | "room_created"
  | "room_joined"
  | "room_paid"
  | "room_received";

interface ActivityItem {
  type: ActivityType;
  counterparty?: string;
  amount?: number;
  token?: string; // ✅ Add this
  txHash?: string;
  description: string;
  splitId?: string;
  roomId?: string;
  timestamp: string;
  recipient: string;
  recipientUsername: string;
  pfp: string;
}

function ActivityListItem({ item }: { item: ActivityItem }) {
  const label = (() => {
    switch (item.type) {
      case "created":
        return "You created a group bill";
      case "joined":
        return "You joined a group bill";
      case "paid":
        return `You paid ${
          item.recipientUsername
            ? `@${item.recipientUsername}`
            : item.counterparty
              ? `@${item.counterparty}`
              : shortAddress(item.recipient)
        }`;

      case "room_created":
        return "You created a table";
      case "room_joined":
        return "You joined a table";
      case "room_paid":
        return `You paid ${item.recipientUsername ? `@${item.recipientUsername}` : shortAddress(item.recipient)}`;
      case "room_received":
        return `${item.counterparty ? `@${item.counterparty}` : "Someone"} paid you`;
      case "received":
        return `${item.counterparty ? `@${item.counterparty}` : "Someone"} paid you`;
      default:
        return "";
    }
  })();
  const timeAgo = (() => {
    const date = new Date(item.timestamp);
    const now = new Date();
    const minutes = differenceInMinutes(now, date);
    const hours = differenceInHours(now, date);
    const days = differenceInDays(now, date);
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  })();
  const router = useRouter();
  const isRoom = item.type.startsWith("room_");

  return (
    <li
      className="hover:bg-white/5 cursor-pointer p-3 border-2 border-white/10 rounded-lg flex justify-between items-center mb-3"
      onClick={() =>
        router.push(isRoom ? `/game/${item.roomId}` : `/split/${item.splitId}`)
      }
    >
      {/* Left Avatar + Label */}
      <div className="flex items-center gap-3">
        {/* Avatar + Type Icon */}
        <div className="relative w-10 h-10 shrink-0">
          {(item.type === "paid" || item.type === "room_paid") &&
          item.recipientUsername ? (
            // Show the recipient's avatar when you paid them
            <img
              src={item.pfp ?? "/splash.png"}
              alt="pfp"
              className="w-full h-full rounded-full object-cover"
            />
          ) : (item.type === "received" || item.type === "room_received") &&
            item.counterparty ? (
            // Show the counterparty who paid you
            <img
              src={item.pfp ?? "/splash.png"}
              alt="pfp"
              className="w-full h-full rounded-full object-cover"
            />
          ) : item.type === "room_created" || item.type === "created" ? (
            <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center font-bold uppercase">
              <Plus className="w-5 h-5" />
            </div>
          ) : item.type === "room_joined" || item.type === "joined" ? (
            <div className="w-10 h-10 rounded-full bg-blue-300 text-blue-800 flex items-center justify-center font-bold uppercase">
              <UserPlus className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-green-200 flex items-center justify-center text-xs text-green-800 font-bold uppercase">
              {item.recipient?.slice(0, 2) ?? item.counterparty?.slice(0, 2)}
            </div>
          )}
        </div>

        {/* Text Info */}
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="text-sm text-white/40">{item.description}</div>
        </div>
      </div>

      {/* Timestamp + Label */}
      <div className="flex flex-col items-end text-sm text-white/30 text-right ml-4">
        <span className="flex items-center gap-1 mt-0.5">
          {(() => {
            switch (item.type) {
              case "created":
              case "room_created":
                return (
                  <>
                    {/* <BadgePlus className="w-4 h-4 text-primary" /> */}
                    {/* <span>Created</span> */}
                  </>
                );
              case "joined":
              case "room_joined":
                return (
                  <>
                    {/* <UserPlus className="w-4 h-4 text-blue-400" /> */}
                    <span>Joined</span>
                  </>
                );
              case "paid":
              case "room_paid":
                return (
                  <>
                    {/* <ReceiptText className="w-4 h-4 text-active" /> */}
                    <span>
                      {parseFloat(item.amount?.toFixed(4) ?? "0")}{" "}
                      {item.token ?? "ETH"}
                    </span>
                  </>
                );
              case "received":
              case "room_received":
                return (
                  <>
                    {/* <ReceiptText className="w-4 h-4 text-green-400" /> */}
                    <span className="text-green-400">
                      +{parseFloat(item.amount?.toFixed(4) ?? "0")}{" "}
                      {item.token ?? "ETH"}
                    </span>
                  </>
                );
              default:
                return null;
            }
          })()}
        </span>

        <div>{timeAgo}</div>
      </div>
    </li>
  );
}

export default function Home() {
  const router = useRouter();
  const { dismiss } = useFrameSplash();
  const [loading, setLoading] = useState<"split" | "table" | null>(null);
  const [insideFrame, setInsideFrame] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [spinOpen, setSpinOpen] = useState(false);
  const [frameAdded, setFrameAdded] = useState(false);
  const { address } = useAccount();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const { open: openScanDrawer } = useScanDrawer();
  const [hasCheckedFrame, setHasCheckedFrame] = useState(false);

  // Fetch username
  useEffect(() => {
    if (!username) {
      sdk.context.then((ctx) => {
        setUsername(ctx.user?.username ?? null);
      });
    }
  }, [username]);

  // 🧠 Prepare activity slices
  const todaysActivity = activity.filter((item) => {
    const timestamp = parseISO(item.timestamp);
    const now = new Date();
    const diffInMs = now.getTime() - timestamp.getTime();
    return diffInMs <= 24 * 60 * 60 * 1000; // last 24 hours
  });

  const latestActivity = [...activity]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, 5);
  // const { isConnected } = useAccount();
  // const { connect } = useConnect();

  useEffect(() => {
    const fetchActivity = async () => {
      if (!address) return;
      setActivityLoading(true);
      const res = await fetch(`/api/activity?address=${address}`);
      const data = await res.json();
      setActivity(data.activity || []);
      setActivityLoading(false);
    };

    fetchActivity();
  }, [address]);

  // useEffect(() => {
  //   const checkFrame = async () => {
  //     const context = await sdk.context;
  //     const isInside = !!context;
  //     setInsideFrame(isInside);
  //     setFrameAdded(context?.client?.added || false);
  //   };

  //   checkFrame();
  //   dismiss();
  // }, [dismiss]);

  useEffect(() => {
    const checkFrame = async () => {
      const context = await sdk.context;
      const isInside = !!context;
      setInsideFrame(isInside);
      setFrameAdded(context?.client?.added || false);
      setHasCheckedFrame(true); // ✅ only render once we know
    };

    checkFrame();
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const tryAddFrame = async () => {
      if (insideFrame && !frameAdded) {
        try {
          await sdk.actions.addFrame();
          setFrameAdded(true);
        } catch (err) {
          console.error("Failed to add frame", err);
        }
      }
    };

    tryAddFrame();
  }, [insideFrame, frameAdded]);

  const handleClick = (path: "/split" | "/table", key: "split" | "table") => {
    setLoading(key);
    router.push(path);
  };

  const handleTabIt = () => {
    if (!recipient.trim()) return;
    router.push(`/r/${recipient.trim().replace(/^@/, "")}`);
  };

  useEffect(() => {
    const handleNativeLinks = async () => {
      const context = await sdk.context;
      if (!context) return;

      const anchors = document.querySelectorAll("a[href^='http']");
      anchors.forEach((el) => {
        const link = el as HTMLAnchorElement;
        const href = link.getAttribute("href");
        const isAlreadyHandled = link.dataset?.sdkBound === "true";

        if (!isAlreadyHandled && href) {
          link.addEventListener("click", (e) => {
            e.preventDefault();
            sdk.actions.openUrl(href);
          });
          link.dataset.sdkBound = "true";
        }
      });
    };

    handleNativeLinks();
  }, []);

  return (
    // <main className="pb-16 bg-background w-full min-h-screen flex flex-col items-center justify-center text-center p-4">
    <main className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-16 pb-32 overflow-y-auto scrollbar-hide">
      {/* <div className="max-w-md p-6 pt-4 flex flex-col space-y-4 rounded-lg">
        {!isConnected && (
            <div className="w-full max-w-sm space-y-4">
              <Button
                className="w-full bg-primary"
                onClick={() => connect({ connector: injected() })}
              >
                Connect Wallet
              </Button>
            </div>
          )}
      </div> */}

      <div className="w-full max-w-sm space-y-4">
        {!hasCheckedFrame ? (
          <div className="flex items-center justify-center h-screen text-white/30 text-sm">
            <Image
              src="/splash.png"
              alt="logo"
              width={72}
              height={72}
              className="object-cover animate-pulse"
              priority
            />
          </div>
        ) : insideFrame ? (
          <>
            <div className="flex flex-col items-center text-center space-y-2">
              <h1 className="text-2xl font-semibold mt-1">gm @{username}</h1>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                className="flex flex-col items-center justify-center bg-white/5 rounded-xl p-3 text-sm"
                onClick={() => setSpinOpen(true)}
              >
                <img
                  src="/money.gif"
                  alt="points"
                  className="w-11 h-11 rounded-md"
                />
                <span className="opacity-40">Daily Spin</span>
              </button>
              <button
                className="flex flex-col items-center justify-center bg-white/5 rounded-xl p-3 text-sm"
                onClick={() => router.push(`/r/${username}`)}
              >
                <QrCode className="hidden w-7 h-7 text-primary" />
                <img
                  src="/qr.png"
                  alt="points"
                  className="w-12 h-12 rounded-md"
                />
                <span className="opacity-40">Request</span>
              </button>

              <button
                className="flex flex-col items-center justify-center bg-white/5 rounded-xl p-3 text-sm"
                onClick={openScanDrawer}
              >
                <ScanLine className="hidden w-7 h-7 text-primary" />
                <img
                  src="/scan.png"
                  alt="points"
                  className="w-11 h-11 rounded-md"
                />
                <span className="opacity-40">Pay</span>
              </button>

              <DailySpinDrawer isOpen={spinOpen} setIsOpen={setSpinOpen} />
            </div>
            <div className="space-y-2 mb-4">
              <Button
                className="w-full bg-primary"
                onClick={() => handleClick("/split", "split")}
                disabled={loading !== null}
              >
                New Group Bill
              </Button>
              <Button
                className="w-full bg-secondary text-white"
                onClick={() => handleClick("/table", "table")}
                disabled={loading !== null}
              >
                New Pay Roulette
              </Button>
            </div>
            {!activityLoading && todaysActivity.length > 0 && (
              <div className="mt-8">
                <h2 className="text-white/40 text-md mb-2 mt-8">Today</h2>

                {todaysActivity.map((item, idx) => (
                  <>
                    <ul className="space-y-3">
                      <ActivityListItem key={idx} item={item} />
                    </ul>
                  </>
                ))}
              </div>
            )}

            {!activityLoading && latestActivity.length > 0 && (
              <div className="mt-16">
                <h2 className="text-white/40 text-md mb-2 mt-8">
                  Latest Activity
                </h2>
                {latestActivity.map((item, idx) => (
                  <>
                    <ul className="space-y-3">
                      <ActivityListItem key={idx} item={item} />
                    </ul>
                  </>
                ))}
              </div>
            )}

            {!activityLoading && activity.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center min-h-[40vh]">
                <div className="bg-white/5 rounded-sm p-6 shadow-sm w-full px-16 mx-8 max-w-[240px] mb-2" />
                <div className="bg-white/5 rounded-sm p-6 shadow-sm w-full px-16 mx-8 max-w-[200px] mb-2" />

                <p className="text-white/30 text-center text-base mt-2">
                  You're all set to go. <br />
                  Create a group bill, join a table, <br />
                  or send your first payment.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex flex-col items-center text-center space-y-2 mb-8">
              <Image
                src="/splash.png"
                alt="logo"
                width={72}
                height={72}
                className="object-cover animate-pulse"
                priority
              />

              <h1 className="text-4xl font-semibold">meet tab</h1>

              <p className="text-white leading-relaxed">
                Social payments on Farcaster
              </p>
            </div>
            <Tilt
              glareEnable={true}
              glareMaxOpacity={0.8}
              glareColor="#ffffff"
              glarePosition="all"
              glareBorderRadius="16px" // same as your Tailwind rounded-xl
              scale={1.03}
              tiltMaxAngleX={8}
              tiltMaxAngleY={8}
              className="p-2 bg-white rounded-xl mb-4"
            >
              <div>
                <QRCode
                  value="https://warpcast.com/~/frames/launch?domain=tab.castfriends.com"
                  size={180}
                  removeQrCodeBehindLogo={true}
                />
                <a
                  href="https://warpcast.com/~/frames/launch?domain=tab.castfriends.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full"
                >
                  <Button className="p-3 w-full bg-primary hover:opacity-80 transition-all">
                    Launch Mini App
                  </Button>
                </a>
              </div>
            </Tilt>
            <div className="flex items-center w-full flex-col">
              <div className="flex items-center gap-1 bg-white/5 rounded-2xl px-1 py-1 w-fit mt-1">
                <input
                  type="text"
                  placeholder="address, ens or fc name"
                  className="text-base placeholder-white/30 bg-transparent p-3 text-white rounded-xl focus:outline-none"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTabIt();
                  }}
                />
                <button
                  onClick={handleTabIt}
                  className="active:transform active:scale-90 transition-all hover:opacity-80 transition-all bg-white text-black p-3 rounded-md text-sm font-medium hover:opacity-90 transition-all"
                >
                  Create
                </button>
              </div>
              <p className="opacity-30 text-xs mt-2">
                Generate a payment link for your ETH address, <br />
                ens or any farcaster username
              </p>
            </div>
            <div className="bg-background text-center fixed bottom-0 inset-x-0 p-2 pb-6 flex justify-around z-1">
              <a
                href={`https://warpcast.com/~/channel/tab`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-white text-center text-sm opacity-30"
              >
                2025 ©tab tech
                <br />
                CA: 0x154af0cc4df0c1744edc0b4b916f6aa028d009b0
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
