// lib/getRecipient.ts (runs on the server only)
import { neynarApi } from './neynar';
import { createPublicClient, http, isAddress } from 'viem';
import { normalize } from 'viem/ens';
import { mainnet } from 'viem/chains';

export const getRecipient = async (recipient: string): Promise<string | null> => {
  const client = createPublicClient({ chain: mainnet, transport: http() });

  if (isAddress(recipient)) return recipient;

  if (recipient.startsWith('@')) {
    try {
      const { user } = await neynarApi.lookupUserByUsername({
        username: recipient.slice(1),
      });

      return user?.verified_addresses?.primary?.eth_address || null;
    } catch {
      return null;
    }
  }

  try {
    const ensAddress = await client.getEnsAddress({ name: normalize(recipient) });
    return ensAddress;
  } catch {
    return null;
  }
};
