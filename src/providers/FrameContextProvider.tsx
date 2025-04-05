import sdk, { FrameContext, SafeAreaInsets } from "@farcaster/frame-sdk";
import React, { useEffect } from "react";

import { Loading } from "@/components/ui/loading";

const FAKE_FRAME_CONTEXT: FrameContext | undefined =
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
          safeAreaInsets: {
            bottom: 0,
            top: 0,
            left: 0,
            right: 0,
          },
        },
        // @ts-ignore-next-line
        fakePayload: true,
      }
    : undefined;

type FrameContextProviderContextValue = {
  fid: number;
  pfpUrl: string | undefined;
  frameAdded: boolean;
  safeAreaInsets?: SafeAreaInsets;
};

const FrameContextProviderContext =
  React.createContext<FrameContextProviderContextValue>([] as never);
function FrameContextProvider({ children }: React.PropsWithChildren) {
  const [frameContext, setFrameContext] = React.useState<
    FrameContext | undefined
  >(FAKE_FRAME_CONTEXT);
  const [noFrameContextFound, setNoFrameContextFound] = React.useState(false);

  const checkFrameContext = React.useCallback(async () => {
    try {
      const isIframe =
        typeof window !== "undefined" && window.parent !== window;
      if (!isIframe) {
        setNoFrameContextFound(true);
        return;
      }

      const ctx: FrameContext = await sdk.context;
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

  // Only render loading while frame context is undefined *and* inside a frame
  if (typeof frameContext === "undefined" && !noFrameContextFound) {
    return <Loading />;
  }

  return (
    <FrameContextProviderContext.Provider
      value={{
        fid: frameContext?.user.fid ?? 0,
        pfpUrl: frameContext?.user.pfpUrl,
        frameAdded: frameContext?.client?.added ?? false,
        safeAreaInsets: frameContext?.client?.safeAreaInsets,
      }}
    >
      {children}
    </FrameContextProviderContext.Provider>
  );
}
export const useViewer = () => {
  const { fid, pfpUrl, frameAdded } = React.useContext(
    FrameContextProviderContext
  );
  return { fid, pfpUrl, frameAdded };
};

export const useSafeArea = () => {
  const { safeAreaInsets } = React.useContext(FrameContextProviderContext);
  return { safeAreaInsets };
};

export { FrameContextProvider };
