import frameSdk from "@farcaster/frame-sdk";

export const isFrame = async (): Promise<boolean> => {
  let resolved = false;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, 100); // increased timeout for safety

    (async () => {
      try {
        const ctx = await frameSdk.context;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(!!ctx);
        }
      } catch (err) {
        console.error("isFrame failed", err);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(false);
        }
      }
    })();
  });
};
