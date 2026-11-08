# Dinner-room coordination beta

## Boundaries and chosen design

The legacy root Providers continue to own Privy/X login and OAuth persistence. AppShell bypasses only its legacy navigation/redirects for `/app`; legacy `/rooms`, `/r`, games, splits, activity, yield and jackpot remain reachable, with no legacy document migration. The dinner server verifies Privy identity independently on every request, then maps the verified Privy ID to a unique internal UUID. No request body can choose its actor. X subject binding comes only from the verified provider user, not a handle or wallet.

Considered separate collections with multi-document transactions versus a bounded room aggregate with compare-and-swap. Chosen: a room aggregate containing membership, invitations, ordered messages, expenses and read cursors. Mongo revision CAS atomically commits invitation acceptance plus membership and confirmed expenses plus cent-exact obligations (amounts and parties change only through an explicit versioned correction; outside-receipt acknowledgement can change status). It requires no replica-set transactions and makes retry behavior testable against real Mongo. Limits (50 members, 100 invitations, 1,000 messages, 200 expenses per room) deliberately keep documents small for this beta. Exceeding them returns a clear error rather than silently dropping history. Extract append-only collections with transactional outbox before lifting limits.

Private raster attachments live in a separate collection, limited to 2 MB per upload, re-encoded to WebP with sharp (no SVG, metadata or original active content served), with authenticated membership checks on upload/download. Addressed receipt requests reuse the existing receipt parser server-side. Only extracted fields reach the room agent; entered fields still require human review and confirmation. Ordinary conversation triggers no assistant reply. Explicit `@Tab` requests process recent room text and shared notes through the scoped assistant described in [Tab agent](tab-agent.md); private images are sent only to the existing parser for addressed receipt requests; the conversational agent receives extracted fields only. Attachments are capped per room; uploaded-but-unused files count toward that limit.

UI calls a small authenticated API. Persisted polling/cursor catch-up every three seconds (and on visibility/online) is the beta transport. The server is authoritative; sent means persisted. Repeating a client retry ID with changed content fails with 409. Expense confirmation is a state transition, not a payment. Activities derive from persisted room/membership/expense state, not best-effort financial writes.

## Local setup

Node 22 recommended; `npm ci`; set `MONGODB_URI`, `NEXT_PUBLIC_PRIVY_APP_ID`, and `PRIVY_APP_SECRET` using your existing Privy app; set `DINNER_ROOMS_ENABLED=true`. `npm run dev`, open `/app`. X login must be enabled in the existing Privy app; existing X graph configuration is optional for sharing single-person invite links. No new bank, wallet, or blob key is required. Generated agent replies reuse the existing optional `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL`; without a key, the agent provides verified read-only summaries.

`npm test` starts a disposable real Mongo via mongodb-memory-server, no application credentials needed. First run downloads a MongoDB test binary. `npm run typecheck` checks the repository; `npm run lint` checks the repository with ESLint. `npm run verify:dinner` runs all three. Never point test fixtures at a production DB.

## Try it with two people

1. Enable the flag, sign in at `/app`, create Friday Dinner with a purpose.
2. Create a single-person invite link (or choose an X following identity and copy its bound link). Share it manually. A second account previews, signs in, and explicitly joins. Joining creates no obligation or spending authority.
3. Chat, reply/react, attach a raster receipt, refresh or disconnect/reconnect and retry a failed send. Read state is server-backed.
4. Add an expense, choose a payer and accepted participants, edit shares in USD, save the draft, review and confirm. Check Money and Activity. A recipient can flag their share.
5. Add another expense in the same room. There are no payment/settle buttons and no cash balance. Legacy wallet remains reachable through a secondary link.

## Gates and deliberate exclusions

No live provider login/graph assertion is made by automated tests. Test Privy redirects and two real accounts on staging before expanding the beta. Existing legacy origin-only authorization gaps are not fixed by this isolated slice; do not interpret new API safety as an audit of old payment routes. No archival/deletion, settlement, pots, refund execution, push notifications, delegated financial agent execution or financial custody in this slice. Disputed shares and flags remain visible. Outside-receipt confirmation does not resolve or erase a flag or amend the share. Confirmed expenses now support the reviewed versioned corrections described below.

## Verification scope

The suite exercises the real Mongo compare-and-swap store (not an in-memory repository mock), HTTP authorization/response contracts, and DOM-driven expense/chat flows through that HTTP/store path. The DOM harness supplies a test actor at the authenticated boundary; it does not bypass authentication in the application. A real Privy/X sign-in and visual desktop/mobile review still require a configured staging Privy app. No production database or real financial action is used by tests.

The pre-existing whole-repository compiler/lint failures were repaired with narrow wire-field types, SDK argument/null guards, and profile parsing (no checks disabled). The existing Verify workflow still depends on a Dockerfile absent from main. Workflow repairs require repository workflow permission and are not part of this PR; run `npm run verify:dinner` for full source/test lint, typecheck and tests without deployment secrets. The new slice does not make existing legacy payment authorization safe; that remains a separate audit.

## Original slice verification (historical)

95 tests pass (84 domain/HTTP/Mongo contracts, ten DOM coordination flows and one document/portal theme test), full TypeScript passes including Next-generated route checks, and source/test ESLint passes with no warnings. A production build also completes with synthetic build-only provider/signer fixtures and localhost-only Mongo/RPC endpoints; this proves compilation and prerendering, not provider connectivity. Whole-app builds still require the legacy `ENCRYPTION_KEY` (32 characters), `PRIVATE_KEY`, and RPC configuration in addition to Privy/Mongo; this is not new dinner-room configuration. Never reuse production signing keys for test builds.

## Outside-payment reports: coordination, not custody

The debtor or expense author can report a full obligation as **Reported paid outside Tab**. It remains outstanding until that obligation’s creditor explicitly confirms receipt. Only the creditor can confirm or reject; only the original reporter can cancel while pending. Rejection/cancellation leave the entire integer-cent obligation outstanding and preserve the old report. There are no partial reports, payment rails, client-supplied hashes, financial receipts, fees or custody in this flow. Flags remain independent and visible even after explicit recipient confirmation.

Each obligation can hold one pending report and up to 50 historical reports in the beta aggregate. Report creation and resolution have scoped retry UUIDs; Mongo CAS atomically resolves the report and, only for creditor confirmation, transitions its obligation to `confirmed_outside`. Existing `outstanding` records with no reports continue working without a migration. The report stores server timestamps, exact cents from the obligation, reporter, resolver and request IDs. Neither chat nor extracted/inferred data can make this transition. Today’s attention and Activity are projections of these persisted facts, never the financial source of truth.

Try at `http://localhost:3000/app` with two accounts: confirm an expense paid originally by Alice and shared with Bob; as Bob, open Money → Report paid outside Tab → Submit outside report. The share remains outstanding. As Alice, Today links to the pending record; open Money → Review outside report → Confirm I received this outside Tab. Alternatively choose I haven’t received this to reject. Bob can cancel an unconfirmed report. No funds move through Tab and no Tab payment receipt is created. Reuse the room for the next expense.

## Document light mode and verification

Middleware overwrites a presentation-only request hint based on `/app` versus legacy paths. The root layout and browser theme-color are light on the server, before JavaScript; a route-aware client layout effect restores the proper classes when navigating between dinner and legacy routes. Dinner-scoped CSS variables cover html/body and body-level dialogs; providers use light skeleton/toast/Privy appearance. Legacy wallet send/scan portals are not mounted on dinner routes, and native share-flag prompts were replaced with inline light forms. Non-dinner tokens and wallet styling are unchanged.

Tradeoff: reading the presentation hint in the root layout makes page rendering dynamic rather than statically prerendered. It does not change authorization or API permissions.

After starting the app with the beta flag, run `npm run test:theme-http` (optional `DINNER_THEME_SMOKE_URL` overrides localhost:3000). Nine HTTP regression tests assert actual server-rendered html classes and theme-color on Today, Rooms, Activity, Wallet, Agent, invitation and three legacy routes, including opposite caller hints. These nine checks also passed against a production build. This is HTTP/DOM verification, not a claim of a real authenticated mobile/desktop browser session.

## Scoped Tab agent and coordination

[Tab agent](tab-agent.md) documents the shared AI SDK runtime, on-demand skills, explicit scoped Mongo memory, private sessions, draft-only tools, wallet projections, agreements, reminders, and Chat SDK decision. [Try the coordination journey](tab-agent-beta.md) covers room mentions, private chat, wallet, and Plan. The bot never gains financial confirmation authority.

## Member removal and financial retention

The room owner is the beta admin. Only that owner may remove an accepted member; removing the owner or transferring ownership is prohibited. A scoped retry UUID deduplicates the append-only removal event in the same room CAS that removes membership. The record retains the member’s stable ID, name, original join time, removal time and actor. No expense, message, image or report is deleted. Active member lists and new-expense validation exclude removed people; agent summaries label their financial rows `accepted: false`.

The Members review explicitly discloses the access policy: removal ends authenticated access to the whole room (including old chat, images and Plan). Already viewed copies cannot be recalled. The next successful authorization failure clears the open room view. Financial history remains with the room, and the former member’s Wallet retains owe/owed totals and pending-report status, without links pretending they still have room access. Former members must coordinate with the owner for corrections or outside-report review; this beta does not provide a separate former-member financial portal. Removal does not forgive debt, transfer ownership or forfeit an overpayment owed back. Old pending invitations cannot restore access after removal; a new invitation requires explicit acceptance.

## Reviewed expense corrections

Any accepted member may propose a correction in Money. The expense author or room owner must explicitly accept it. Affected accepted participants can dispute a proposed correction; a disputed proposal is never applied. After clarification, prepare a new proposal (the old dispute remains visible). Existing share flags remain durable and visible independently. Corrections are bound to the reviewed expense version; stale proposals fail. Draft corrections never affect balances. Retry IDs prevent duplicate proposals and adjustments under CAS.

Acceptance appends a complete snapshot of the previous fields, shares, flags, obligations and outside reports, with a reversal time, actor and correction ID. The expense retains its stable ID, increments its version, and records new obligations atomically. Money shows current fields plus version history and proposals; Who owes whom, Wallet, Activity and member_summary project the new version after refresh. History is bounded at 50 correction proposals per expense; exceeding the limit preserves existing records and returns an error.

Resolve or cancel pending outside reports before accepting a correction so a pending claim cannot be silently discarded. Creditor-confirmed outside receipts remain credited, deduplicated by original obligation ID across versions. If a correction reduces an already paid share, the overpayment becomes a new obligation owed back, not an automatic refund or Tab payment. Corrections may retain or reduce a removed person’s existing share and retain the existing payer; they cannot add or increase a removed person’s debt. New participants and new payers must be accepted members. USD shares stay nonnegative integer cents and sum exactly to the total.

## Receipt extraction

`src/lib/receipt.ts` is the shared existing OpenAI receipt parser used by `/api/receipt` and dinner attachments. No new vendor, key or model configuration was added. Only an image already posted in the authorized room can be parsed for Tab. A receipt-directed mention uses its own image, a replied-to image, or the latest earlier posted image. `prepare_expense` also extracts a valid linked image and caches the result for that run. Original protected WebP attachments are retained.

The parser returns merchant, totalAmount, currency, items and confidence. A USD total with confidence at least 0.7 and exact cents can populate a proposal. Missing/unreadable/low-confidence/non-USD totals require an explicit USD amount; missing payer or participants requires clarification. Invalid supplied IDs still fail accepted-member validation. The conversational model receives extracted fields, never pixels; only the existing extraction model receives the image. No extracted text authorizes financial or membership actions.

## Coordination continuation verification

`npm run verify:dinner` passes 114 tests, full TypeScript and ESLint with zero warnings on Node 24. The added Mongo/HTTP/DOM cases cover removal access and retry behavior, financial/image retention, correction history/staleness/disputes/authorization, confirmed outside credits, receipt extraction and clarification, draft-only assistant corrections, and current wallet/member summaries. Browser fixture checks of the actual Members/Money components at 360px and desktop verify no horizontal overflow, keyboard focus, reduced-motion styling and 44px buttons. These fixture checks do not assert live Privy/X authentication or live model extraction. No production `next build` was run.
