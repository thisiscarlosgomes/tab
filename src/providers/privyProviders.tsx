// providers/PrivyProvider.tsx
'use client';
import { PrivyProvider as Provider } from '@privy-io/react-auth';

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}>
      {children}
    </Provider>
  );
}
