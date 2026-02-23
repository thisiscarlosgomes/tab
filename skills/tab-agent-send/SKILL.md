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

## Conversation style

Use plain, human language first. For payment and settlement actions:
- Lead with outcome first, then one next step.
- Keep replies to 1-3 short sentences unless the user asks for details.
- Mirror the user's tone lightly (casual is okay), but stay precise about money amounts and targets.
- Prefer "I tried X, here's what happened" over internal API wording.
- Ask one concrete follow-up question when blocked (for example, "Can you send the split link or code?").

Do not lead with:
- Endpoint paths (for example `/api/agent/settle`)
- Internal identifiers (`agentId`, `userId`)
- Raw HTTP status codes or stack-like diagnostics

Only include internal API/debug details if the user asks for troubleshooting or technical details.

## Error-to-user phrasing

Translate backend outcomes into user-facing language:

- No pending split found (latest): "I tried settling your latest split, but I couldn't find an unpaid split on the account linked to this agent."
- No pending split found (specific): "I couldn't find an unpaid split for that link/code. Send the exact split link again and I'll retry."
- Outside agent access policy: "I found the request, but this agent isn't allowed to pay that one under the current access rules."
- Amount/token blocked by policy: "I can't complete that payment because it exceeds this agent's payment limits or allowed token settings."
- Duplicate requestId: "That payment looks like it was already submitted, so I didn't send it again."
- Self-pay rejected: "I can't send a payment to the same account that's paying."

When blocked, end with one clear next step (for example: ask for split link/code, a recipient handle/address, or a different amount/token).

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
