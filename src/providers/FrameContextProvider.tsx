"use client";

import React, { useEffect, useState, useCallback, createContext, useContext } from "react";
import sdk from "@farcaster/frame-sdk";

import { Loading } from "@/components/ui/loading";

// Infer the type from the SDK
type InferredFrameContext = Awaited<typeof sdk.context>;


// Fake context for dev only — cast to inferred type
const FAKE_FRAME_CONTEXT: InferredFrameContext | undefined =
  process.env.NODE_ENV === "development"
    ? {
        user: {
          fid: 1287,
          pfpUrl:
            "https://i.seadn.io/gcs/files/ed56e6b9a1b22720ce7490524db333e0.jpg?w=500&auto=format",
        },
        client: {
          clientFid: 9152,
          added: false,
        },
        // @ts-ignore: not part of actual type, but useful for mock
        fakePayload: true,
      } as InferredFrameContext
    : undefined;

type FrameContextProviderContextValue = {
  fid: number;
  pfpUrl: string | undefined;
  frameAdded: boolean;
};

const FrameContextProviderContext =
  createContext<FrameContextProviderContextValue>([] as never);

function FrameContextProvider({ children }: React.PropsWithChildren) {
  const [frameContext, setFrameContext] = useState<InferredFrameContext | undefined>(FAKE_FRAME_CONTEXT);
  const [noFrameContextFound, setNoFrameContextFound] = useState(false);

  const checkFrameContext = useCallback(async () => {
    try {
      const isIframe =
        typeof window !== "undefined" && window.parent !== window;

      if (!isIframe) {
        setNoFrameContextFound(true);
        return;
      }

      const ctx = await sdk.context;
      if (ctx) {
        setFrameContext(ctx);
      } else {
        setNoFrameContextFound(true);
      }
    } catch {
      setNoFrameContextFound(true);
    }
  }, []);

  useEffect(() => {
    if (typeof frameContext === "undefined") {
      checkFrameContext();
    }
  }, [checkFrameContext, frameContext]);

  if (typeof frameContext === "undefined" && !noFrameContextFound) {
    return <Loading />;
  }

  return (
    <FrameContextProviderContext.Provider
      value={{
        fid: frameContext?.user.fid ?? 0,
        pfpUrl: frameContext?.user.pfpUrl,
        frameAdded: frameContext?.client?.added ?? false,
      }}
    >
      {children}
    </FrameContextProviderContext.Provider>
  );
}

export const useViewer = () => {
  const { fid, pfpUrl, frameAdded } = useContext(FrameContextProviderContext);
  return { fid, pfpUrl, frameAdded };
};

export { FrameContextProvider };
