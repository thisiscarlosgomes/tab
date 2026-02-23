export const AGENT_SKILL_MARKDOWN = `# tab

Send token payments and settle split shares from a user's delegated Privy wallet with Agent Access guardrails.

## Endpoint

- \`POST /api/agent/send\`
- \`POST /api/agent/settle\`
- \`POST /api/agent/link/start\`
- \`GET /api/agent/link/claim/:token\`
- \`POST /api/agent/link/claim/:token\`

## Auth

One of:
- \`Authorization: Bearer <privy_identity_or_access_token>\`
- \`x-agent-key: <AGENT_EXECUTOR_KEY>\` and body includes \`agentId\` + \`userId\`

## Input

Send payment:

\`\`\`json
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
\`\`\`

Settle split share:

\`\`\`json
{
  "agentId": "YourAgentName",
  "userId": "did:privy:..."
}
\`\`\`

Or provide one of \`splitId\`, \`splitCode\`, or \`splitUrl\` to target a specific split.

## Link flow

1. Agent creates claim link:

\`\`\`json
POST /api/agent/link/start
{
  "agentId": "YourAgentName",
  "agentName": "OpenClaw",
  "expiresInMinutes": 30
}
\`\`\`

2. Human opens returned \`claimUrl\` and confirms in Tab UI.
3. Agent can then execute send or settle with \`agentId\` + \`userId\`.

## Behavior

- Uses only the delegated wallet from active Agent Access policy.
- \`/api/agent/settle\` accepts any one of \`splitId\`, \`splitCode\`, or \`splitUrl\` (including URLs with \`?code=...\`); if omitted, it settles the latest pending eligible split.
- Enforces \`allowedToken\`, \`maxPerPayment\`, \`dailyCap\`, and expiry.
- Resolves \`@username\` through Neynar and supports ENS names (for example \`.eth\`).
- Rejects self-pay and duplicate \`requestId\`.
- Returns tx hash on success.

## Discovery

- \`GET /api/agent/skills\` returns machine-readable skill metadata.
- \`GET /api/agent/health\` returns server readiness flags.
`;
