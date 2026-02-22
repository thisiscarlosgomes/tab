'use client';

import React from 'react';

type FrameSplashProviderContextValue = {
  dismiss: () => void;
};

const FrameSplashProviderContext =
  React.createContext<FrameSplashProviderContextValue>([] as never);

function FrameSplashProvider({ children }: React.PropsWithChildren) {
  const dismiss = React.useCallback(async () => {
    return;
  }, []);

  return (
    <FrameSplashProviderContext.Provider value={{ dismiss }}>
      {children}
    </FrameSplashProviderContext.Provider>
  );
}

export const useFrameSplash = () => {
  return React.useContext(FrameSplashProviderContext);
};

export { FrameSplashProvider };
