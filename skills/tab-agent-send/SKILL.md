---
name: tab
description: Send token payments and settle split shares from a user's delegated Privy wallet with Agent Access guardrails.
---

# tab

Use this skill when a user asks an agent to send money or settle a split share, for example:
- "split 0.2 eth @alex @rita"
- "Send $0.50 to @alice"
- "Pay 0.5 USDC to 0xabc..."
- "Send 0.5 USDC to vitalik.eth"
- "Pay my share for split lunch-ab12"
- "Settle my split from https://usetab.app/split/abcd1234"
- "Settle my latest split"

## Endpoint

- `POST /api/agent/split/create`
- `POST /api/agent/send`
- `POST /api/agent/settle`
- `POST /api/agent/link/start`
- `GET /api/agent/link/claim/:token`
- `POST /api/agent/link/claim/:token`

## Auth

One of:
- `Authorization: Bearer <privy_identity_or_access_token>`
- `x-agent-key: <AGENT_EXECUTOR_KEY>` and body includes `agentId` + `userId`

## Input

Create split:

```json
{
  "agentId": "YourAgentName",
  "userId": "did:privy:...",
  "amount": "0.2",
  "token": "ETH",
  "users": ["@alex", "@rita"],
  "description": "Dinner split"
}
```

Send payment:

```json
{
  "agentId": "YourAgentName",
  "userId": "did:privy:...",
  "recipient": "@alice",
  "amount": "0.50",
  "token": "USDC",
  "recipientEns": "vitalik.eth",
  "note": "coffee split",
  "requestId": "optional-idempotency-key"
}
```

Settle split share:

```json
{
  "agentId": "YourAgentName",
  "userId": "did:privy:..."
}
```

Or provide one of `splitId`, `splitCode`, or `splitUrl` to target a specific split.

## Link flow

1. Agent creates claim link:

```json
POST /api/agent/link/start
{
  "agentId": "YourAgentName",
  "agentName": "OpenClaw",
  "expiresInMinutes": 30
}
```

2. Human opens returned `claimUrl` and confirms in Tab UI.
3. Agent can then execute send or settle with `agentId` + `userId`.

## Behavior

- `/api/agent/split/create` creates an invited split and returns a confirmation payload with amount, currency, split URL, and tagged users.
- Uses only the delegated wallet from active Agent Access policy.
- `/api/agent/settle` accepts any one of `splitId`, `splitCode`, or `splitUrl` (including URLs with `?code=...`); if omitted, it settles the latest pending eligible split.
- Enforces `allowedToken`, `maxPerPayment`, `dailyCap`, and expiry.
- Resolves `@username` through Neynar and supports ENS names (for example `.eth`).
- Rejects self-pay and duplicate `requestId`.
- Returns tx hash on success.
