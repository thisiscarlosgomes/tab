"use client";

import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Home, Activity, Send } from "lucide-react";
import sdk from "@farcaster/frame-sdk";
import { useSendDrawer } from "@/providers/SendDrawerProvider";
import Link from "next/link";

export function FooterNav() {
  const pathname = usePathname();
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [seed, setSeed] = useState("anon");
  const { open } = useSendDrawer();
  const [animateHome, setAnimateHome] = useState(false);
  const [animateSend, setAnimateSend] = useState(false);
  const [animateActivity, setAnimateActivity] = useState(false);
  // const [fid, setFid] = useState<number | null>(null);

  // useEffect(() => {
  //   const loadContext = async () => {
  //     const context = await sdk.context;
  //     const user = context?.user;
  //     setPfpUrl(user?.pfpUrl ?? null);
  //     setFid(user?.fid ?? null);
  //     const fallbackSeed = `user-${user?.fid ?? "anon"}`;
  //     setSeed(user?.username || fallbackSeed);
  //   };
  //   loadContext();
  // }, []);
  

  const handleAnimate = (
    setter: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    setter(true);
    setTimeout(() => setter(false), 300);
  };

  useEffect(() => {
    const loadContext = async () => {
      const context = await sdk.context;
      const user = context?.user;
      setPfpUrl(user?.pfpUrl ?? null);
      const fallbackSeed = `user-${context?.user?.fid ?? "anon"}`;
      setSeed(user?.username || fallbackSeed);
    };
    loadContext();
  }, []);

  const navItems = [
    {
      href: "/",
      label: "Home",
      icon: (
        <span
          className={clsx(
            "inline-block",
            animateHome && "animate-scale-bounce"
          )}
        >
          <Home className="w-7 h-7 mb-1" />
        </span>
      ),
      onClick: () => handleAnimate(setAnimateHome),
    },
    {
      label: "Send",
      icon: (
        <span
          className={clsx(
            "inline-block",
            animateSend && "animate-scale-bounce"
          )}
        >
          <Send className="w-7 h-7 mb-1" />
        </span>
      ),
      onClick: () => {
        handleAnimate(setAnimateSend);
        setTimeout(() => {
          open(); // open modal after short delay
        }, 450); // delay matches animation duration
      },
    },
    {
      href: "/activity",
      label: "Activity",
      icon: (
        <span
          className={clsx(
            "inline-block",
            animateActivity && "animate-scale-bounce"
          )}
        >
          <Activity className="w-7 h-7 mb-1" />
        </span>
      ),
      onClick: () => handleAnimate(setAnimateActivity),
    },
    {
      href: "/profile",
      label: "Profile",
      icon: pfpUrl ? (
        <img src={pfpUrl} alt="User" className="w-7 h-7 mb-1 rounded-full" />
      ) : (
        <img
          src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(
            seed
          )}`}
          alt="Fallback Avatar"
          className="w-7 h-7 mb-1 rounded-full"
        />
      ),
    },
  ];

  // const navItems = [
  //   {
  //     href: "/",
  //     label: "Home",
  //     icon: (
  //       <span
  //         className={clsx("inline-block", animateHome && "animate-scale-bounce")}
  //       >
  //         <Home className="w-7 h-7 mb-1" />
  //       </span>
  //     ),
  //     onClick: () => handleAnimate(setAnimateHome),
  //   },
  //   ...(fid === 2201
  //     ? [
  //         {
  //           label: "Send",
  //           icon: (
  //             <span
  //               className={clsx(
  //                 "inline-block",
  //                 animateSend && "animate-scale-bounce"
  //               )}
  //             >
  //               <Send className="w-7 h-7 mb-1" />
  //             </span>
  //           ),
  //           onClick: () => {
  //             handleAnimate(setAnimateSend);
  //             setTimeout(() => {
  //               open();
  //             }, 450);
  //           },
  //         },
  //       ]
  //     : []),
  //   {
  //     href: "/activity",
  //     label: "Activity",
  //     icon: (
  //       <span
  //         className={clsx(
  //           "inline-block",
  //           animateActivity && "animate-scale-bounce"
  //         )}
  //       >
  //         <Activity className="w-7 h-7 mb-1" />
  //       </span>
  //     ),
  //     onClick: () => handleAnimate(setAnimateActivity),
  //   },
  //   {
  //     href: "/profile",
  //     label: "Profile",
  //     icon: pfpUrl ? (
  //       <img src={pfpUrl} alt="User" className="w-7 h-7 mb-1 rounded-full" />
  //     ) : (
  //       <img
  //         src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(
  //           seed
  //         )}`}
  //         alt="Fallback Avatar"
  //         className="w-7 h-7 mb-1 rounded-full"
  //       />
  //     ),
  //   },
  // ];

  return (
    <footer className="fixed bottom-0 inset-x-0 bg-card p-5 pb-12 flex justify-around z-10">
      {navItems.map(({ href, label, icon, onClick }) =>
        href ? (
          <Link
            key={href}
            href={href}
            onClick={onClick}
            className={clsx(
              "flex flex-col items-center text-xs",
              pathname === href ? "text-white" : "text-white/40"
            )}
          >
            {icon}
            <span className="hidden">{label}</span>
          </Link>
        ) : (
          <button
            key={label}
            onClick={onClick}
            className="flex flex-col items-center text-xs text-white/40"
          >
            {icon}
            <span className="hidden">{label}</span>
          </button>
        )
      )}
    </footer>
  );
}
