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

`DinnerAgentService` owns seven Mongo collections:

- `dinner-agent-sessions`: one private transcript per verified internal user.
- `dinner-agent-notes`: separate user preferences, shared room memory, and shared agreements.
- `dinner-agent-runs`: per-source run leases and tool outcomes, including failed tool execution.
- `dinner-agent-proposals`: owner-scoped review proposals with room membership validation.
- `dinner-reminders`: private, owner-scoped in-app reminders.
- `dinner-receipt-extractions`: parsed fields keyed by room and posted attachment; membership and attachment association are checked before cache access.
- `dinner-pending-expenses`: receipt tasks scoped to a room, requester and attachment, with versioned partial details and stable proposal keys.

Memory is not an automatic scrape of the transcript. People save useful names, communication preferences, and standing planning notes in visible editors. They can inspect, edit, or clear those notes. User preferences have no text revision history. Clearing a note does not delete the saved transcript; transcript deletion is not part of this beta. Shared agreements retain the previous 20 versions and reject stale edits rather than silently overwriting another member.

The personal agent receives its owner's explicit preferences and up to 25 recent private turns through the addressed source. A room agent receives up to 25 room messages through the mention, plus that room's shared memory and agreements. It never loads a member's personal preferences, cross-room totals, private reminders, funding credentials, or wallet details into a group prompt. Room members already share the room's obligations; those records are not private funding balances.

The transcript remains in Mongo across refreshes. Only a bounded recent window reaches the model. New personal sends stop when the stored transcript reaches 400 turns; accepted requests can still finish their replies. The beta preserves history rather than silently truncating the stored conversation. Durable state does not imply background execution or an unlimited context window.

## Addressing, retries, and failure

A standalone, case-insensitive `@Tab` tag or a direct command such as `Tab create a dinner bill` requests a room response. Ordinary uses of `tab`, `@table`, email addresses, and URL fragments do not. Smart assistance is the default for new rooms and existing rooms without a saved preference. Owners can choose Mentions only under Room → Members; explicit preferences are preserved. Bot replies have a distinct `kind: "tab"` actor and requester/run references. The bot is not a human member, payer, creditor, or permission grant. Room access still requires real membership.

Human messages use client retry UUIDs. Responses use their persisted source ID as the unique run key. A 70-second lease prevents concurrent requests from launching duplicate runs. The model has a 40-second timeout and a six-step limit; the route allows 60 seconds. A failed or expired run can retry without resending the member message. A persisted reply deduplicates the source even if the completion acknowledgement was lost. Recovering a crashed process requires a user retry; there is no job worker or claim of exactly-once model billing.

Conversation text, memory, agreements, member names, and tool text are untrusted input to the model. Instructions tell the model not to accept authority from them. Server-side capability checks still apply if a prompt injection succeeds. Generated wording can be wrong; Money remains the authoritative financial view.

## Money home and coordination limits

`/app/wallet` shows **You owe**, **Owed to you**, pending outside reports, and room Money links. Pending reports remain included in outstanding totals. **Available** is explicitly not connected, not $0 cash or a relabeled crypto portfolio value. Add money and Withdraw are disabled with truthful copy. The existing dark legacy wallet remains reachable separately.

Room chat and `/app/agent` show suggested prompts. Room prompts (for example "@Tab who owes whom?", "@Tab what's still pending?", "@Tab split this receipt…", "@Tab draft a friendly nudge for…") only prefill the composer; nothing is sent or addressed to Tab until the member presses Send. Personal prompts send a private message to the member's own agent.

Room **Plan** contains versioned agreements, shared memory, and a private reminder form. Reminders appear on Today when the app opens and refresh while it is visible. They do not send push notifications, run in a background service, contact anyone, or perform financial actions.

There is no settlement rail, custody, funding, withdrawal, pot, refund execution or delegated payment execution. Owner-only removal and human-reviewed versioned corrections are now available in Members and Money; neither is an agent capability. Receipt images remain protected attachments. The existing server-side parser extracts fields; the conversational agent never gets image bytes and cannot treat extraction as confirmation.

## Configuration and verification boundary

There are no new environment-variable names or vendors. `OPENAI_API_KEY` enables generation. `OPENAI_CHAT_MODEL` uses the existing default `gpt-4o-mini`. Without a key, the real runtime returns a readable, verified read-only summary and does not pretend to understand or prepare a natural-language split. The existing Mongo, Privy, beta flag, and whole-app legacy build requirements remain unchanged.

The database and DOM suites use a disposable MongoDB process and an injected model runner. They test actual authorization, persistence, proposals, wallet projections, agreements, reminders, and retry behavior without provider calls or production data. A separate test covers the real runtime without a model key. The browser suite below covers rendered chat, HTTP, disposable MongoDB, streaming, and persistence. Its opt-in live mode also exercises OpenAI tool selection and receipt OCR. Real Privy/X sign-in and the Next.js deployment boundary still need staging review. A passing build alone is not evidence that provider paths were exercised.

[Try the agent and coordination journey](tab-agent-beta.md). [Dinner-room storage and outside-report design](dinner-room-architecture.md).


## Browser conversation regression tests

Run from the repository root with Node 24:

```sh
npm ci --legacy-peer-deps
npx playwright install chromium
npm run test:chat-browser
```

For an installed Google Chrome, use `npm run test:chat-browser -- --chrome`.
The controlled suite runs on chat-related pull requests via `chat-browser.yml`; it needs no model credentials. It uses the actual DinnerShell, Room, Chat, API handler, service, attachment processing and a disposable MongoDB. Only Privy identity, Next navigation and model/receipt responses are replaced. No production authentication bypass or test endpoint is added.

To repeat the same browser journey with the existing model credentials and actual receipt OCR:

```sh
npm run test:chat-browser-live
# Or: npm run test:chat-browser-live -- --chrome
```

Live mode reads `.env.local` only for existing provider configuration. Its database is always disposable; the application's Mongo URI is not used. It sends a generated test receipt and fictional room transcript to the configured provider. It never posts to a real room. Model responses vary, so live tests are opt-in and assertions check facts and actions rather than exact prose.

Coverage:

- Untagged messages and uploads save without bot requests; forced untagged bot requests are rejected.
- A tagged question uses earlier room conversation and leaves one saved reply after reload.
- Balances preserve creditor direction and display 50 cents as $0.50.
- Receipt, payer and participant turns retain one attachment/extraction and produce one review proposal.
- A payer-only statement cannot create a proposal with guessed participants. The server checks the requester's explicit named or room-wide participant selection. Ambiguous selections need clarification.
- The human Save action creates an editable draft; the agent never confirms it.
- Completed retries return the saved reply without duplicate proposals or model calls.
- Controlled streaming interruption and in-flight retry tests preserve member messages, deduplicate replies and exclude later messages from earlier context.
- Other-room access is denied; no other-room text enters the model context.
- Desktop/mobile rendering, page errors and unexpected failed requests are checked.

Screenshots, Playwright traces and HTTP evidence are written to `/tmp/tab-browser-controlled` or `/tmp/tab-browser-live`. Open a trace with `npx playwright show-trace /tmp/tab-browser-controlled/trace.zip`. CI uploads controlled evidence as an artifact. These fixtures do not test Privy/X login, Next.js routing/build behavior, or production database connectivity.

### Comparing conversation reconstruction with saved expense state

`npm run test:chat-compare -- --chrome` runs matched isolated browser journeys for the current runtime (A) and a candidate inspired by the legacy skill's simpler server APIs (B). Omit `--chrome` to use Playwright Chromium. `--rounds=2` repeats each pair; the default is one round. `--approach=pending` reruns only the candidate after a change, retaining the unchanged baseline evidence. This uses the existing provider credentials in `.env.local` and performs real model/OCR calls, but all room and expense data lives in disposable MongoDB.

The three scenarios are a short receipt follow-up, a payer clarification followed by 30 unrelated messages and a service restart, and an odd-cent receipt requiring an exact remainder split. Both approaches use the same model, receipt image, UI, HTTP handler and financial validation. Approach order alternates by scenario. Assertions inspect records, not just the assistant's wording. Each batch writes a report, timings, tool outcomes, transcripts, screenshots and traces under `/tmp/tab-agent-comparison-*` and `/tmp/tab-browser-compare-*`. A completed comparison can contain failed scenarios; inspect `results.json`, rather than treating the comparison process exit code as a correctness result.

The original comparison candidate remains in `tests/dinner/experiments/pending-runner.ts` for reproducibility. Production now uses the hardened pending flow described below. The comparison command uses `--legacy` to disable that flow for the historical baseline. B persists a pending receipt per room/requester/attachment, resolves explicit names to members, checks supporting user messages, and calculates equal shares on the server. It requires the state tool on the first step of an incomplete task before acknowledging changes. Live testing caught an early version claiming the payer was saved even though the update had been rejected. Requiring a tool call alone was insufficient: the update must preserve each independently supported field rather than discard a valid payer when a guessed participant list is rejected. The candidate now persists supported fields and returns rejected fields as clarification needs. It also requires new user evidence before changing a known payer; a participant-only follow-up cannot replace the payer with the current speaker. A mock-model regression reproduces both invalid tool calls and verifies persistence across restart, exact odd-cent allocation and retry deduplication.

This is a comparison of two Tab designs, not a replay of Base wallet chat's unknown external agent configuration. The candidate currently targets readable USD receipts and equal splits. Corrections, manual total edits, ambiguous references across multiple tasks, and crash recovery across different source messages are not covered by these experiments. Small samples show concrete failure modes, not production reliability estimates. Keep those limits in mind before adopting B as the default runtime.


### Production receipt workflow

Room receipt requests now use `pending-expense.ts` and `pending-runtime.ts`. The server saves the receipt total, payer, explicit participants and equal-split method separately from the 25-message model context. The model supplies names and explicit details through `update_pending_expense`; the server verifies them against the requester’s room messages and resolves accepted members. Unsupported guesses cannot erase supported fields or overwrite a known payer without new evidence. A missing or unreadable USD total can be supplied explicitly, including a bare amount when Tab has asked for the total.

Receipt replies are formatted from saved state. They identify the payer and label allocations as **shares**, never debts. Model narration is not streamed as a financial confirmation. The saved reply is delivered through the existing NDJSON mechanism once validation completes. Ordinary room questions retain the existing streaming runtime and scoped tools; personal chat, nudges, explicit corrections and custom-split requests retain their existing paths. Tab responds to direct requests and authorized Smart assistance follow-ups.

Before preparing a proposal, the server freezes its validated fields under a stable task key. Recovery after a lost acknowledgement, even through a later message, returns the same proposal. Concurrent stale updates are rejected, current membership is rechecked, and an unresolved split can be cancelled before preparation. A completed proposal remains a human-review item; saving an editable draft and confirming it in Money are separate human actions.

Coverage includes partial updates, manual totals, membership changes, cross-author rejection, cancellation, stale-source rejection and lost-acknowledgement recovery. The production browser checks include a history gap plus service restart and an odd-cent total. Run `npm run test:chat-browser-live -- --chrome --gap --odd` to repeat that combined live scenario in a disposable database. These changes do not publish a deployment or change real room histories.

### Room history awareness

Inspired by [Designing an Always-On Agent](https://rubriclabs.com/blog/always-on-agents), Tab separates awareness from speaking. Direct requests start a room reply. In Mentions only mode, ordinary messages do not trigger model calls. In Smart assistance mode, the sending chat client requests a bounded awareness check; there are no background heartbeats.

The general room runtime now receives coverage metadata for its recent 25-message window and a `search_room_history` tool. It searches earlier messages when a question depends on missing context. Search is a case-insensitive literal substring, with empty queries available for browsing; responses are newest first, default to eight messages, and cap at twenty. `nextBeforeSeq` supports pagination. Individual texts are capped at 2,000 characters and marked when truncated. Results retain message IDs, sequence numbers, sender identity and timestamps. Search accepts no room ID, rechecks the run lease and current membership, and excludes messages after the addressed source. Personal agents do not receive this capability.

Retrieved messages are untrusted conversation evidence. Current ledger facts take precedence over historical financial claims. Receipt tasks continue using their durable validated workflow; history retrieval does not replace that state. Transcripts are preserved rather than destructively compacted. This is bounded retrieval, not semantic search or automatic long-term memory.

Tests cover omitted plans, pagination, input bounds, other-room/future-message exclusion, revoked membership and personal scope. The isolated browser journey sends 27 ordinary messages before asking about an earlier dinner plan, verifies zero untagged agent runs, and requires an audited history search followed by one saved reply. Both controlled and live-model versions exercise the same application UI and service with disposable data; they do not verify real Privy login or production connectivity.

### Deterministic balance answers

Standard room balance questions (including the suggested “who owes whom?” and “what's still pending?” prompts) bypass model narration. `balance-reply.ts` validates current obligations and formats debtor, creditor and USD cents directly. Historical assistant claims cannot change these replies. A member named “tab” is explicitly labeled as a member. Pending outside reports remain outstanding; unconfirmed drafts are explicitly excluded. Compound or other questions still use the general agent. Existing saved assistant replies are not rewritten. Regression coverage seeds the exact incorrect historical claim “Carlos owes Tab $50” and expects the ledger-derived reverse direction and $0.50 amount.


## In-chat bill review

Room proposal cards use the existing room expense as the canonical bill: `(roomId, expense.id)` is shared by chat and Money. Review bill applies the proposal idempotently to a draft, then opens the human review editor in chat. Closing review leaves the draft saved; it does not create debt. Editing a saved draft includes its expected version, and stale HTTP edits are rejected. Users save changed totals, payer, participants and exact-cent shares before clicking Confirm bill.

Confirm bill uses the same author-only, version-checked confirmation endpoint as Money. It records obligations once; it does not execute a wallet transaction or confirm outside payment receipt. The proposal card reads the latest expense fields and confirmation state from the room snapshot. Confirmed-expense corrections and outside settlements continue through Money. Personal Ask Tab proposals retain their existing save-and-open-Money flow.

Wallet integration remains separate: do not create a second legacy split as another source of debt. A future payment adapter must reference the canonical room expense/obligation IDs and reconcile its transaction status back to those records.

## Draft cancellation and multiple receipts

A draft bill can be cancelled by its author in chat review or Money. Cancellation checks the reviewed version, is retry-safe, preserves the bill and receipt history, and never creates obligations or sends a payment. Cancelled bills cannot be edited or confirmed. Confirmed bills require the existing correction flow instead of cancellation.

When a requester has multiple collecting/preparing receipt tasks in one room, an unqualified clarification or cancellation changes neither task. Tab asks the requester to reply directly to the intended receipt image and tag it. Explicit image references select the task by attachment ID. Evidence from a different receipt's conversation segment cannot supply the selected task's payer or participants. Each receipt keeps its own draft/proposal identity.


### Smart assistance and conversational focus

Owner-controlled `PATCH /rooms/:id/assistance` selects `mentions` or `smart` (default smart). The chat calls `POST /rooms/:id/awareness` after an ordinary saved message in smart mode. A structured, read-only classifier sees at most 25 messages, member identities, pending-bill count, and persisted offer state. Bill-topic and clear-agreement checks constrain unsolicited offers. Direct `Tab create…` commands bypass this check.

Offers are persisted with their topic message, the two speakers, status, and timestamps. They do not create proposals. An immediate “yes” to the offer binds to it without model inference. Acceptance authorizes the normal agent to ask for missing details. A saved question establishes a short-lived follow-up: the accepting member can answer immediately without a tag; another member must explicitly reply to the question. Unrelated answers, decline, completion, or 15 minutes of inactivity end focus. The original topic and explicitly selected participants accompany the scoped agent context. `Just us two` selects the original two speakers only when the requester is one of them; otherwise clarification is required. The server blocks preparation until the participant selection matches the requested shares.

Each topic is offered once, with a two-minute offer cooldown. Compare-and-swap checks discard decisions when a newer message arrives. Response runs and proposal keys remain idempotent. The model cannot enable the setting, authorize itself, confirm an expense, or send a payment. A proposal remains subject to the existing human review UI.

The exact `I paid for both` clarification updates the payer on two collecting receipts owned by the requester in that room; totals and participant selections are retained. Ambiguous multi-receipt instructions still require selecting a receipt.

Validation: `tests/dinner/smart-awareness-live.ts` uses the configured model with disposable Mongo only; `tests/dinner/smart-awareness-browser.ts` exercises the complete UI/API/data path with a controlled classifier and agent.


### Durable conversational bills and background recovery

`dinner-bill-tasks` stores non-receipt bill fields, explicit participants, split method, source evidence, status, and the last question independently of the model window. Original facts are retained across process restarts and long conversations. Preparation freezes validated fields and uses `bill-task:<taskId>` as the proposal key; retries after a proposal write reuse that proposal. `@Tab resume the same bill` continues the most recent task. Multiple collecting tasks require replying to the intended question. Cancellation and removed-member validation remain server enforced. The model receives saved slots plus at most 25 evidence messages.

Every eligible persisted member message also creates an idempotent `dinner-agent-jobs` record. Hosted requests publish it to Vercel Queues (`tab-room-agent`, region `iad1`) before acknowledging the send. The worker starts after an eight-second delay, allowing the foreground streaming response to finish first; it skips existing replies, rechecks membership, and uses the same agent-run/task/proposal deduplication. The queue retries failures up to five deliveries. Work records retain failed/cancelled state for diagnosis and manual retry; permanent membership failures do not keep retrying. The callback requires the per-job token stored by the authenticated enqueue path. No callback can choose an actor, room, financial action, or arbitrary tool arguments.

Local `next dev` uses Next `after` instead of hosted delivery; Mongo task state is still persistent but local execution is not durable after the local server exits. Production uses the registered queue trigger in `vercel.json`. Queue-publication failures leave the saved message and job intact and return a failed send acknowledgement; retrying the same message ID safely republishes it.


### Addressing Tab by name

Direct address includes greetings (`hey Tab`, `good morning Tab`), a name plus command or question (`Tab create…`, `Tab, who paid?`), trailing vocatives (`can you split this, Tab?`), and explicit replies to a saved Tab message. These work in Mentions only mode as direct requests. Third-person references (`Tab said…`, `last week Tab was…`), browser/bill nouns, and quoted examples do not trigger this name rule. Recognizing an address only authorizes a response, not a financial action. Greetings do not create bill tasks. The assistant address is stripped before participant matching so a human member named Tab is not accidentally included in a split.

This release uses bounded English phrase and punctuation rules, not general semantic addressee detection. Unfamiliar phrasing can be missed; explicit `@Tab` and replies remain the reliable fallback. A later semantic router can classify addressee and dialogue act using room context and persisted questions, without changing financial permission checks. Proactive smart-assistance offers remain a separate decision.

### Bill references and independent receipt drafts

New manual bill requests bypass unrelated receipt drafts and retain their own durable task. A pending manual question can continue even when old receipt drafts exist. Receipt names and USD amounts can select a unique draft; matching both requires agreement, and duplicate matches require clarification rather than picking the newest. Replying to an image remains an optional precise reference. Read-only room facts expose current bill IDs, names, formatted amounts and statuses so the agent distinguishes receipt drafts, review proposals and confirmed obligations. Settlement requests bypass receipt collection; chat cannot execute payments. Confirmation replies direct users to Review bill → Confirm bill.

### Direct conversation follow-ups

A saved Tab question accepts the immediately following message from the same requester for 15 minutes, including in mentions-only mode. Replies to other messages, other members' messages, and explicit mentions of another member do not inherit the conversation. Incomplete manual tasks persist `expectsReply` on the bot message, so follow-ups do not depend on generated punctuation. Completed validated manual equal-split tasks prepare their review proposal directly; the model cannot repeatedly ask for already supplied participants. Financial confirmation remains a human action.

`@Tab ^` resolves the preceding member message. Explicit replies to a bot question follow its saved `runId` back to the originating request, allowing recovery of older conversations without using generated text as financial evidence. A new manual task and its answers take priority over unrelated receipt drafts.

Run `npm run test:chat-followups` with local model credentials for six isolated browser/API/database scenarios, including old receipt drafts and a human member named tab. It uses production agent code and the real model for incomplete conversations; complete validated tasks use the deterministic preparation path. Each scenario checks a single $1.20 proposal, two $0.60 shares, unchanged old receipt tasks/ledger, and refresh stability. Artifacts: `/tmp/tab-followup-e2e`.

### Human bill actions and group notices

Room bill cards expose Confirm and Edit. Confirm applies the proposal and confirms the canonical draft using the displayed version; stale drafts cannot silently confirm changed amounts. Edit opens an accessible modal with amount, payer, participants and shares. Saving edits closes the modal; confirmation stays on the card. Equal shares recalculate when the total changes; custom shares remain editable.

Edits, cancellations, confirmations, outside-payment reports and recipient decisions append a Tab activity message atomically with the underlying room update. Stable event keys and existing request idempotency prevent duplicate notices. A report is explicitly awaiting recipient confirmation; only a recipient-confirmed report says the share was settled outside Tab. No wallet payment execution is implied. Anyone in the room can explicitly reply to a Tab activity message to trigger the agent, under the same authorization checks as other bot replies.

Receipt continuation requires an explicit receipt/name/amount reference or a reply tied to its active question. Generic bill vocabulary and the mere presence of collecting receipt tasks do not select a receipt. Unrelated requests omit receipt drafts from model context. “Create a new tab” starts the same durable manual workflow as “create a new bill”; caret references contribute the referenced member's explicit amount, participants and split method to that task.

### Action-first room routing

Production room turns classify the newest request before receipt extraction or task selection. The typed route distinguishes new manual bills, manual follow-ups, receipt details, lookups, future payment requests, edits, and general conversation. A past-tense payer statement is receipt evidence, not payment authorization. Routes and explicit receipt selections are saved under the leased run, so retries retain their decision.

Creation opens a durable manual task independently of old receipt drafts. Server evidence must establish the total, payer and participants; missing details produce a question rather than a model-invented proposal. Explicit receipt selection remains fixed instead of being replaced by the newest image. Existing human confirmation and payment controls still apply.

`tests/dinner/compare-action-routing.ts` runs the eight matched scenarios twice against production routing with isolated MongoDB and the configured real model; it performs no payment execution. Prior baseline results are retained in `/tmp/tab-routing-comparison-1794250342169/validated-results.json`. Live runner wrappers must explicitly inject `classifyAction` as the service's sixth dependency; custom test runners otherwise omit model routing. No model credentials retains the read-only fallback.

### Deleting an unpaid split

The creator can choose **Delete split** on a confirmed bill in Money while no share has a pending or confirmed repayment report. The original payer's purchase is not a repayment. The server checks current obligations and corrected-version payment history inside the room's atomic update. Concurrent deletion/payment reporting cannot both succeed. Deletion removes outstanding balances and active bill cards, retains the record for audit, and posts one idempotent group notice. Paid splits remain protected; drafts retain their existing Cancel bill action.

### Message bursts and publication

Production room replies use `Bursts` before the agent runner. Both the foreground HTTP path and durable queue resolve the same persisted source message. Only scheduled/started requests are eligible roots; historical mentions alone cannot capture a new message. Explicit caret/reply references retain their original evidence even when the turn contains only one message. A 1.2-second quiet interval collects rapid follow-ups, capped at five seconds of waiting. Up to 12 candidate messages from the same author within 60 seconds can join the source while it is unanswered. Other authors, new attachments, and replies to a different message are excluded before model classification. The semantic classifier distinguishes details/corrections/cancellation from separate requests and identifies which request started each task; it returns identities only, never rewritten financial facts. Answers to the current assistant question take priority over older unfinished requests, and a newer assistant response ends eligibility for older implicit roots. Validated grouping decisions are cached by the exact source/candidate IDs.

`dinner-agent-bursts` persists the root, consumed message IDs, revision and worker lease. A retry from any consumed message resolves to that root. Only one worker owns it; another worker returns `running`, so queue delivery retries instead of incorrectly acknowledging unfinished work. The original action and receipt identity survive revisions. Routing sees the original request's context; the agent still sees the latest 25 messages through the grouped turn, with original authors and source evidence. Newer related fields update the durable task; they do not authorize confirmation or payment.

During work, a new eligible message invalidates the attempt and causes regrouping. Checks run before tool use and publication, with a final check inside the room's compare-and-swap reply write. Proposals carry a source/revision publication marker. They are hidden from room/personal views and cannot be applied until a matching bot reply commits. Superseded proposals stay hidden and cannot become financial records. Coordinated room replies expose their final text after commit rather than streaming text that may become obsolete. The typing indicator remains visible while requests are active; personal streaming is unchanged.

The bounded burst window is not general cross-member task merging. A later message after the reply uses the existing follow-up/edit flow. Human confirmation, current-room membership checks, source-bound payer evidence, and ledger-derived totals remain authoritative.

Validation: `tests/dinner/bursts.test.ts` covers interleaved authors, retries/restarts, a correction after proposal preparation, the atomic publication boundary, receipt extraction, cancellation, concurrent workers, and forged grouping IDs. `tests/dinner/burst-classifier-live.ts` exercises semantic separation with the configured model. `tests/dinner/burst-browser.ts` uses the real room UI/API/agent with disposable MongoDB; its receipt parser is controlled so a correction can be injected during extraction. Existing follow-up browser regressions also enable production burst classification.

### Lookup replies

Lookup intent distinguishes numerical counts from bill lists and specific records. Only explicit count/aggregate requests use the deterministic room summary. Identification questions use current, room-scoped bill descriptions, formatted USD totals, and statuses across the full room, including published review proposals and excluding cancelled records. Replies to Tab messages remain addressed requests in mentions-only mode; no additional @Tab is needed. The live lookup browser regression covers a quoted summary followed by “which one”, including a misspelled request, without preparing or changing bills.

### Explicit reply coordination

Each addressed room turn carries server-resolved reply provenance alongside the latest 25 room messages. The bounded chain follows explicit reply IDs (or a bot reply's persisted run ID), strictly backward within the authorized room, up to 12 ancestors. Missing/future links are not guessed; truncation is explicit. The router and generation runtime both see the referenced messages and author IDs, plus recent-message relationships. Quoted text remains untrusted data; current database bill state remains authoritative.

A uniquely linked manual task is supplied as reference context, including owner, status and proposal ID. Continuing an older question resolves its original task through source IDs even after its latest question changes. A fresh creation intent does not inherit fields from a quoted old task. Lookups never resume tasks, and task updates retain their existing owner checks. Existing burst revision guards and separate-task classification remain in force.

Run diagnostics persist trigger, source/reply IDs, resolved chain IDs, referenced versus selected task IDs, selected receipt, intent, burst revision, current bill/proposal IDs read, and published reply ID. They reuse the existing room-authorized run storage; no new public diagnostics endpoint or credentials are introduced.

Verification: `coordination-browser.ts` uses the real model and actual chat Reply controls to identify dinner and taxi bills after 30 intervening messages across two authors. Automated tests cover old-question corrections, new-task isolation, bounded/missing/future links, preserved 25-message coverage, and persisted decision traces.
