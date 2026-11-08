# Tab agent: scoped help, not financial authority

Tab uses one runtime for addressed room messages and private conversations. It reads authorized records and prepares expense proposals. It cannot confirm an expense, report payment, confirm outside receipt, move funds, or change confirmed shares. Those capabilities are absent from its tool set, not merely forbidden in a prompt.

## Why AI SDK rather than Chat SDK

[Chat SDK](https://chat-sdk.dev/docs) (`chat`) connects bots to external channels through adapters, event handlers, and state storage. It is not an in-app chat UI kit. It becomes useful if Tab later supports Slack, Teams, Discord, or Telegram. An adapter would still need explicit identity linking, room membership checks, and the same limited runtime. No external-channel compatibility is promised here.

The established Next.js app already uses Vercel AI SDK in `AssistantChatPage` and `/api/chat`. The dinner runtime uses the installed AI SDK 6 `ToolLoopAgent`, typed tools, and `stepCountIs(6)`. Both assistants share the existing OpenAI provider/model factory in `src/lib/tab-chat-model.ts`. The new runtime does not import legacy wallet or delegated execution tools. No `chat` package, adapter vendor, or separate eve app is added.

Dinner uses a small authenticated HTTP transport rather than an optimistic streaming transcript. Sending first persists a human message. A separate response request then generates and saves the assistant reply. This preserves a useful distinction: a model failure cannot turn an acknowledged member message into a failed send, or label a model reply as saved before persistence.

The response request streams. When a client sends `Accept: application/x-ndjson` to `POST /api/dinner/rooms/:id/bot` or `POST /api/dinner/agent/respond`, the runtime uses `ToolLoopAgent.stream` and the route emits `{"type":"delta"}` lines, then a final `{"type":"done","status","text"}` only after the reply is persisted. A failure after text has started emits `{"type":"error"}`; no bot reply is saved and **Ask Tab to reply** retries the same source message. Errors raised before any text (authorization, missing source) keep their normal JSON status codes. Clients that do not ask for NDJSON get the previous JSON response. The streamed text is an unsaved preview labelled **Tab · replying**; the saved reply replaces it on refresh. This borrows the legacy `/assistant` streaming experience without its optimistic `useChat` transcript, because rooms must persist the member message first.

The research informed these choices:

- [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents) support bounded tool loops and explicit typed tools. Version-matched implementation references are the installed `ai/docs/03-agents/02-building-agents.mdx`, `06-memory.mdx`, and `07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`.
- The [Agent Skills format](https://agentskills.io/specification) and [Anthropic's open-source skills](https://github.com/anthropics/skills) separate a small discovery catalog from instruction files loaded when needed. Tab adopts that structure, not a filesystem execution tool.
- [eve](https://eve.dev/docs) separates durable agent state from conversation context. Tab keeps that useful separation in its existing Mongo/Next.js application instead of introducing another application framework.

AI SDK 7 is available upstream. This increment stays on the repository's installed AI SDK 6.0.103 to avoid an unrelated migration of the legacy assistant. Upgrade and provider evaluation belong in a separate change.

## Authorization lives below the model

Every new API route sits behind `DINNER_ROOMS_ENABLED=true` and verified Privy identity. The server selects the internal user ID. Request bodies cannot supply an actor, wallet, role, or model scope.

The runtime exposes six tools:

- `load_skill`: reads one of three allowlisted, versioned instruction files.
- `read_context`: reads the current room, or the requesting user's room totals and pending reports.
- `read_room`: reads shared facts only after membership validation. A room agent is fixed to its original room, even if the requester belongs to others.
- `member_summary`: read-only per-member outstanding owe/owed totals and pending outside-report counts for a member room (same room restriction as `read_room`). Totals include integer US cents (`oweCents` / `owedCents`) plus formatted `oweUsd` / `owedUsd` (50 cents is `$0.50`); replies should use the formatted fields.
- `draft_nudge`: drafts reminder wording to a member who owes the requester. It returns `sent: false` and is never posted, delivered, or scheduled; the requester copies it (**Copy to send yourself** on Tab replies) and sends it themselves.
- `prepare_expense`: validates accepted members and integer-cent totals, then stores one review proposal per source message. It does not create an expense or obligation. Optional `correctionOf` and `expectedVersion` prepare a draft-only correction to a confirmed expense. It may link a receipt via `attachmentId` only when that attachment was already posted in a message in this room; the server invokes the existing receipt parser and supplies extracted fields, never image bytes, to the conversational model. Missing total, payer or shares returns `needs_details`, so Tab asks instead of guessing. Low-confidence or non-USD extraction requires an explicit USD total.

Successful tool calls record their name, scope (`user-read`, `room-read`, or `room-prepare`), and outcome against the run. There is no generic HTTP, shell, filesystem, payment, receipt-confirmation, message-send, or memory-write tool. The fixed skill reader cannot load `skills/tab-agent-send` or a path supplied by a model.

Only the proposal's human requester can choose **Save editable draft**. That endpoint rechecks membership and calls `DinnerService.draft` with the proposal UUID as its stable retry ID. A correction proposal instead calls `DinnerService.proposeCorrection`; only the expense author or room owner can accept it through Money. The tool has no apply-correction capability. The existing Money flow still requires human review and confirmation before obligations exist. A private proposal is not visible to the room until the requester saves it as a financial draft. A room proposal is shared for review, but another member cannot apply it as its author.

Outside-payment reports still require the creditor's explicit Money action. Chat, a skill, a preference, a reminder, an agreement, a reaction, a hash, and model output never count as receipt evidence. Flags remain independent. Legacy delegated hooks remain separately gated and are not reachable from this runtime.

## Durable conversations and explicit memory

`DinnerAgentService` owns five Mongo collections:

- `dinner-agent-sessions`: one private transcript per verified internal user.
- `dinner-agent-notes`: separate user preferences, shared room memory, and shared agreements.
- `dinner-agent-runs`: per-source run leases and successful tool audit entries.
- `dinner-agent-proposals`: owner-scoped review proposals with room membership validation.
- `dinner-reminders`: private, owner-scoped in-app reminders.

Memory is not an automatic scrape of the transcript. People save useful names, communication preferences, and standing planning notes in visible editors. They can inspect, edit, or clear those notes. User preferences have no text revision history. Clearing a note does not delete the saved transcript; transcript deletion is not part of this beta. Shared agreements retain the previous 20 versions and reject stale edits rather than silently overwriting another member.

The personal agent receives its owner's explicit preferences and up to 25 recent private turns through the addressed source. A room agent receives up to 25 room messages through the mention, plus that room's shared memory and agreements. It never loads a member's personal preferences, cross-room totals, private reminders, funding credentials, or wallet details into a group prompt. Room members already share the room's obligations; those records are not private funding balances.

The transcript remains in Mongo across refreshes. Only a bounded recent window reaches the model. New personal sends stop when the stored transcript reaches 400 turns; accepted requests can still finish their replies. The beta preserves history rather than silently truncating the stored conversation. Durable state does not imply background execution or an unlimited context window.

## Addressing, retries, and failure

Only an explicit standalone, case-insensitive `@Tab` tag requests a room response. Ordinary `tab`, `@table`, email addresses, and URL fragments do not. Bot replies have a distinct `kind: "tab"` actor and requester/run references. The bot is not a human member, payer, creditor, or permission grant. Room access still requires real membership.

Human messages use client retry UUIDs. Responses use their persisted source ID as the unique run key. A 70-second lease prevents concurrent requests from launching duplicate runs. The model has a 40-second timeout and a six-step limit; the route allows 60 seconds. A failed or expired run can retry without resending the member message. A persisted reply deduplicates the source even if the completion acknowledgement was lost. Recovering a crashed process requires a user retry; there is no job worker or claim of exactly-once model billing.

Conversation text, memory, agreements, member names, and tool text are untrusted input to the model. Instructions tell the model not to accept authority from them. Server-side capability checks still apply if a prompt injection succeeds. Generated wording can be wrong; Money remains the authoritative financial view.

## Money home and coordination limits

`/app/wallet` shows **You owe**, **Owed to you**, pending outside reports, and room Money links. Pending reports remain included in outstanding totals. **Available** is explicitly not connected, not $0 cash or a relabeled crypto portfolio value. Add money and Withdraw are disabled with truthful copy. The existing dark legacy wallet remains reachable separately.

Room chat and `/app/agent` show suggested prompts. Room prompts (for example "@Tab who owes whom?", "@Tab what's still pending?", "@Tab split this receipt…", "@Tab draft a friendly nudge for…") only prefill the composer; nothing is sent or addressed to Tab until the member presses Send. Personal prompts send a private message to the member's own agent.

Room **Plan** contains versioned agreements, shared memory, and a private reminder form. Reminders appear on Today when the app opens and refresh while it is visible. They do not send push notifications, run in a background service, contact anyone, or perform financial actions.

There is no settlement rail, custody, funding, withdrawal, pot, refund execution or delegated payment execution. Owner-only removal and human-reviewed versioned corrections are now available in Members and Money; neither is an agent capability. Receipt images remain protected attachments. The existing server-side parser extracts fields; the conversational agent never gets image bytes and cannot treat extraction as confirmation.

## Configuration and verification boundary

There are no new environment-variable names or vendors. `OPENAI_API_KEY` enables generation. `OPENAI_CHAT_MODEL` uses the existing default `gpt-4o-mini`. Without a key, the real runtime returns a readable, verified read-only summary and does not pretend to understand or prepare a natural-language split. The existing Mongo, Privy, beta flag, and whole-app legacy build requirements remain unchanged.

The database and DOM suites use a disposable MongoDB process and an injected model runner. They test actual authorization, persistence, proposals, wallet projections, agreements, reminders, and retry behavior without provider calls or production data. A separate test covers the real runtime without a model key. Model wording, live OpenAI tool selection, real Privy/X sign-in, and authenticated desktop/mobile visuals still need staging review. A passing build is not evidence that those provider paths were exercised.

[Try the agent and coordination journey](tab-agent-beta.md). [Dinner-room storage and outside-report design](dinner-room-architecture.md).
