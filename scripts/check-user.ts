import { neynarApi } from '@/lib/neynar';

// vitalik.eth
const addr = "0x0000006616620615198f612C9022424DF919dB98";
const user = await neynarApi.fetchBulkUsersByEthOrSolAddress({addresses: [addr]});

console.log(user);