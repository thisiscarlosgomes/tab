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

## Structured plans

Room Plan now supports individual outings alongside the existing agreements and reminders. An organizer creates a draft with accepted room members, one to five time options, an IANA event time zone, an estimated USD maximum per person, an area/venue, and an optional response deadline. Publish collects Works / If needed / Can't responses; unanswered is distinct. Budget acceptance is separate from availability. Private requirements are visible only to their author and organizer and can be cleared, including after cancellation or completion.

Drafts can be edited before publication, including their title, invited members, budget, area, time zone and options. Extending or removing a response deadline preserves existing responses and notes. Adding accepted room members preserves availability; if final terms already exist, it increments the terms version and requires everyone to confirm again.

The organizer proposes exact final details, members explicitly accept or decline that terms version, and the organizer reviews the included/excluded roster before finalizing. Material edits clear approvals. Reopening options clears responses. A confirmed participant can withdraw their own attendance with version and retry checks; the original finalized roster remains in history. Today distinguishes upcoming, ongoing and past outings. Completion is available after the outing ends; cancellation preserves history. No plan operation creates an expense, reservation, spending authority, or payment. Agent preparation and expense linking remain separate later increments.

`dinner-plans` stores one bounded aggregate per outing, with revision CAS, participant response versions, terms versions, scoped retry IDs, and decision/terms history. Private fields are projected out before HTTP responses; generic room payloads and agent contexts do not receive plan documents. Room membership is checked on every operation. Room removal ends access to plans as well as chat. Plan mutations recheck membership, but room membership and plan documents are separate; cross-document removal races need further verification. Room plan history has cursor pagination, while Today shows up to 100 recently updated active plans. Limits are 50 participants, five options, and 200 normal history entries; privacy clearing, one-way withdrawals, cancellation and completion remain possible at the history limit. These exceptions remain bounded: no new responses, term changes or participant additions are allowed at the limit. Closed plans cannot be otherwise changed.

Start at `/app/rooms/:roomId?view=plan`. Today cards link to a particular plan. Polling updates persisted state; stale organizer edits retain their inputs and show the latest saved details for explicit review before retrying. Stale member responses also preserve local input. No background push or notification delivery is added. Deadlines use server time. Calendar exports use stable UIDs, UTC instants, UTF-8 folding, and terms sequence numbers; downloaded files do not automatically synchronize. Ambiguous and nonexistent DST times are rejected using the Temporal polyfill.

Verification adds real Mongo/HTTP tests for concurrency, retries, authorization, private projections, version invalidation, deadlines, pagination, DST and calendar output, plus DOM-driven creation through finalization and participant visibility tests. Run `npm run verify:dinner`. Live Privy authentication and visual staging review remain separate from these automated tests.


### Isolated browser verification

`npm run test:plans:browser` starts a separate Next.js fixture on loopback port 3107 and a disposable real MongoDB process. Install its browser once with `npx playwright install chromium`. The fixture lives entirely under `tests/dinner/browser`, imports the production Room/Home/planning components and HTTP/domain/storage implementation, and supplies test-only cookie sessions for Alice, Bob and Carol. Its environment is allowlisted and does not load the application's `.env.local`; no production authentication code is changed. The test owns its server, so port 3107 must be free. `npm run dev:plans:browser` is available for a manual isolated walkthrough and must be stopped before the automated test.

The browser regression uses separate desktop and mobile Chromium contexts. It verifies draft editing, published responses, deadline preservation, concurrent form edits with explicit review, individual approval, finalization, withdrawal, adding a new participant with fresh approvals, Today deep links, a downloaded ICS file, an offline/reconnect cycle, cross-session cancellation and rejection of requests without a test session. Screenshots and failure traces go to `.test-artifacts/plans`. TypeScript, ESLint and 117 Mongo/HTTP/DOM tests passed; both two-session browser journeys also passed. Live Privy/X authentication, the production provider shell, physical mobile browsers and import into a third-party calendar app are outside this fixture's coverage. The ICS download and contents are tested; calendar synchronization is not implemented.

### Plans in conversation

Conversation shows compact cards for the six most recently updated published plans, with the viewer's next action (Respond, Edit response, Confirm or View details). Links select the correct room tab and plan without requiring a page reload. Availability summaries in Plan now expand to show member names for Works, If needed, Can't and Awaiting response.

The authenticated `/rooms/:id/plan-feed` endpoint projects persisted plan history into chronological updates alongside chat messages. Publication, revised terms, finalization, withdrawal, new participants, deadline changes, reopened options, cancellation and completion produce visible updates. They are derived from the same atomic plan document as the underlying change, with stable history IDs; no second notification write or message impersonation is involved. Draft edits, individual availability submissions, private-note changes and unpublished cancelled drafts are excluded. Mongo projections explicitly select shared fields, so no private note text or retry hashes reach conversation responses, even for organizers.

The feed returns 50 updates per page using a validated timestamp/plan/index cursor, including deterministic ordering for identical timestamps. Client polling deduplicates IDs and preserves already-loaded history. Older events link to the current plan; historical proposed terms are labeled with their version. Plan updates do not affect chat message read cursors, trigger the agent, send external notifications, or constitute an AI response. Agent plan preparation remains a later increment.

Coverage adds Mongo/HTTP tests for private projections, authorization, stable IDs, same-timestamp pagination and viewer-specific actions, plus a second desktop/mobile browser journey through publication, conversation messages, response links, named availability, revised terms, confirmations, refresh and cancellation. Browser checks also enforce a usable message viewport and prevent the composer/sidebar from overlapping the chat. Plan cards scroll horizontally while the message log retains its own bounded height.

### Read-only agent planning integration

Room and personal agents have a `read_plans` tool: room scope stays fixed to its room;
private scope checks membership for each requested room. It returns at most ten
recently updated published plans (`hasMore` signals truncation), or one requested
plan ID. Unpublished drafts are excluded. The explicit projection excludes private
notes even for organizers, history payloads, and request hashes.

The projection supplies named works/if-needed/unavailable/unanswered groups,
budget compatibility/unknowns, current-terms decision gaps and confirmed attendees.
Option ordering matches Plans: works plus if-needed, then works, then chronology.
Chronological ties are not preference; availability is not approval. No planning
mutation capability is registered. Links open the authoritative Plans UI.

Without a model key, planning questions receive a labeled deterministic summary
from the same authorized projection. This fallback is exercised through the real
browser → chat → agent → Mongo → saved reply flow with disposable identities;
it does not verify a live model's tool selection or answer quality. Provider-enabled
runs use the existing AI SDK agent and model configuration.

Next: agent-prepared editable plan proposals, including incomplete ideas, followed
by explicit human review/publication. Then completed-outing expense drafts and
final full-flow verification. Discovery, booking and payments remain out of scope.

### Agent plan ideas and human review

`prepare_plan` stores one replay-safe proposal per saved agent run in
`dinner-agent-plan-proposals`. It accepts an idea and nullable title, participants,
time zone, location, budget and time options. Missing values remain missing; no
plan aggregate, availability response, consent or expense is created by this tool.
Room agents remain fixed to their room. Personal proposals are excluded from the
room proposal feed. Nonmembers and pending invitees cannot be selected.

Conversation and personal-agent cards link the requester to a prefilled review
form. Unknown fields are blank, including participants and time zone. The original
incomplete proposal survives refresh; unsaved form edits are local until the member
saves a complete draft. The requester-only apply endpoint validates complete plan
fields through PlanService and uses the proposal ID as the creation retry key.
Concurrent matching saves and recovery after a lost linking write return the same
plan; different competing edits conflict. Publication is a separate explicit action
in the existing Plans UI. Other members can see room ideas but cannot apply them.

Without a model key, an explicit “prepare/draft/create/propose a plan” request saves
the request text as an idea, with every structured detail unknown. It explicitly
states that generation is not configured. This provides an end-to-end test path
without pretending to interpret the request or using provider credentials.

Verification covers service/HTTP authorization, personal visibility, incomplete
fields, competing saves, crash recovery and the mobile chat → proposal review →
draft → human publication flow against disposable Mongo and isolated identities.
Next: prepare an editable expense draft from a completed outing, then final
full-flow verification. Live provider response quality remains a separate check.

### Completed outing → expense draft

Completed Plans link to Money with the outing's confirmed attendee IDs preselected.
The actual total and payer remain blank: estimated budgets never become charges.
Members can revise who actually shared the cost, enter the actual bill, adjust
exact-cent shares and attach an existing room receipt. Saving produces only an
expense draft; the author reviews and confirms separately in Money.

`POST /rooms/:roomId/plans/:planId/expense` checks membership, a completed source
plan, complete expense fields and receipt access. `sourcePlanId` is server-assigned
metadata, excluded from general expense inputs. The room's atomic revision update
allows one linked expense per outing, including simultaneous saves by different
members; matching retries return the same draft and conflicting saves return 409.
Additional unrelated bills can still be entered through ordinary Add expense.
Editing and confirmation retain the source link. Preparing or confirming an
expense never changes the completed plan or performs a payment.

The agent's existing `prepare_expense` tool accepts an optional `sourcePlanId`.
It verifies the completed source plan before preparing a proposal, and human apply
uses the same linked-draft path. Instructions require the actual total and payer
and prohibit substituting the plan estimate. Missing details lead to a link to the
human entry form. Read-only plan results continue to exclude private notes.

### Plans scope verification

The isolated test suite covers room access, private notes, stale approvals,
responses, time zones, drafts, agent proposals, publication, final consent,
withdrawal, completion and exact-cent expense drafts. Browser coverage follows a
saved agent idea through mobile human review/publication, final consent, completion,
actual-bill entry, saved draft and explicit human expense confirmation, checking
persisted server records and a second member's view. The fixture advances only its
test clock; it adds no production authentication or time override.

This completes the agreed implemented Plans scope (read-only planning help,
editable agent proposals, human review/publication, completed-outing expenses and
isolated full-flow verification). Before production rollout, live Privy sign-in
and configured-model answer/tool-selection quality still need environment-specific
smoke testing. Discovery, booking and payments remain excluded.

### Local live multi-participant lab

`npm run dev:plans:live` starts the isolated fixture on loopback port 3108 with
Carlos as host and four labeled synthetic participants (Maya, Leo, Nina, Owen).
It selectively passes only the existing model key/model override to the fixture;
normal automated browser tests still receive no provider credentials. The room
and temporary Mongo database disappear when the process stops.

The host joins with Continue as Carlos. Saved host messages now trigger automatic
replies through a fixture-only Next.js after hook. Names and @mentions route to
specific participants; @Tab-only requests do not wake the four participants.
Group messages invite all four. Run a round remains a manual fallback. Each
participant gets one bounded AI SDK turn; the session permits 20 rounds and can
pause/resume automatic replies. Message-ID deduplication prevents repeated turns
on HTTP retries; rapid messages during a round coalesce to the latest pending
request. Agent messages never trigger another round. Agents have distinct synthetic preferences,
read only this room's conversation and safe plan projections, and can submit only
their own availability or current-terms decision through normal PlanService
validation. They cannot publish/finalize plans, create expenses or move money.
The existing @Tab coordinator remains available separately. All lab endpoints and
identity selection live outside deployed src/app. This is a local development
harness, not a public staging login mechanism or proof of production Privy auth.

### Proposal cards in conversation

Plan idea cards are attached to the persisted request/reply using the proposal's
agent run key. When the corresponding message is outside the loaded page, the
card appears at its own creation time in the timeline rather than below the
composer. Cards show a short proposal identifier, creation time, actual proposed
place/budget/time/participants, missing details, and changed fields compared with
the previous same-title suggestion by the same requester in the same scope.
Earlier same-title suggestions are collapsed and link to the latest. This is
presentation grouping, not a destructive merge or automatic supersession: older
ideas remain reviewable. Saved proposals show Saved to Plans and link to the
canonical plan, whose page owns publication and confirmation status.

### Conversational lock-in

When every invited participant explicitly accepts the current exact terms, the
last acceptance atomically changes the plan to confirmed, fixes the attendee
roster and records one `auto_finalize` history event (including the last decision
and exact terms). There is no additional organizer finalize step for unanimity.
The existing explicit finalize action remains for an accepted subset; unresponded
or declined members are never silently included. Material edits reopen approval.

Confirmed/completed chat summaries use a short paragraph with the time, place,
estimated per-person budget and a view/edit link, rather than another review
card. Saved proposal cards become a small link to their authoritative plan.
Conversational “yes” messages alone still do not substitute for versioned final
consent, and incomplete ideas cannot be locked without exact terms.

### Live coordinator rehearsal

The host-only local `/api/test/scenario` endpoint accepts `create-coordinator`
and `start-coordinator`. It creates a separate room, then runs the four synthetic
participants with short chat and a small-talk interlude. Real `DinnerAgentService`
requests produce messages labeled Tab and a saved plan proposal. The harness
explicitly applies/publishes that proposal as Maya; Tab's deployed read/prepare
permissions are unchanged. The harness also proposes exact terms and the later
7:30-to-7:00 change. Each participant's model must call its own typed availability
and consent tools. The runner checks that the change clears old approvals,
rejects stale-version consent, collects four current-version decisions, and locks only if all four accept.
A decline must leave the changed plan unconfirmed with no new lock event or expense. Tab reads and
summarizes saved state at each milestone. This verifies the integration under
controlled organizer actions, not an autonomous production organizer or Privy.

Room replies prefetch the same private-note-free planning projection before model
generation, so skipping a read tool cannot leave Tab relying only on chat claims.
Synthetic participant availability is calculated from declared fixture preferences
and validated when saved; this tests tool integration, not unconstrained model
reasoning about schedules. Fixture Mongo clients reuse a bounded pool across dev
reloads, and new disposable database processes use a 256 MB WiredTiger cache.

### Explicit chat opt-outs and organizer finalization

For a room with exactly one proposed/confirmed plan, persisted messages addressed
to @Tab now support narrow commands without a model deciding authorization:
`can we do later?` asks a clarification without changing attendance;
`go ahead without me` (also `I can't make it`, `I'm not going`, `count me out`)
records only the message author's decline, or withdrawal from a confirmed outing;
`go ahead` / `yes, go ahead` lets only the plan creator finalize the accepted subset.
Conditionals, quoted commands, third-party claims, and bare `yes` are not actions.
Multiple active plans require an explicit target or clarification. Commands predating the latest proposed
terms cannot change the newer version. Existing PlanService revision and consent
checks apply; retries do not duplicate finalization. Opting out preserves room
membership and does not create expenses. The local `create-optout` / `start-optout`
scenario injects Owen's schedule conflict and organizer prompts, uses real models
for participant chat/acceptances, and exercises the production chat-action service
for negotiation, opt-out, and organizer finalization. No harness finalize call is
used in this scenario.

An opted-out invited participant can say `@Tab I want to rejoin` (or `count me
back in` / `I can make it after all`). This saves their current-terms acceptance
but does not add them to confirmed attendees. The organizer's `@Tab go ahead`
approves pending rejoin requests through a revision-checked `approve_rejoins`
command. Existing attendees and terms stay locked; no fresh approval is needed
from the others. A pending request can be withdrawn again. Old terms, non-invitees,
non-organizer approval, and requests for past outings are rejected. The local
`rejoin-after-lock` scenario verifies request/approval retries and preserves Owen's
opt-out while adding Nina back to Maya and Leo.

### Bundled coordination checks

The host-only `create-bundle` / `start-bundle` fixture runs two sequential plans
in a single watchable room. It tests a time change while a rejoin is pending,
late organizer messages, fresh exact-version consent, a budget conflict,
non-organizer finalization, ambiguous chat, repeated requests, all attendees
withdrawing, and rejoin after cancellation. It asserts no expenses or membership
changes. GET `/api/test/scenario` exposes the local run's checks and failure.
Setup and time/budget changes are explicit harness actions; participant decisions
use their model tools and chat commands use the production agent service.

When the final attendee withdraws, the outing returns to confirming with no
confirmed attendees; it is not automatically cancelled or presented as ready.
Cancelled/completed plans stay closed when someone asks to rejoin. Confirmation
status replies prefer the sole active plan, while explicitly named plans and
multiple-active-plan ambiguity are preserved.


### Targeting simultaneous plans

Supported @Tab commands can end with `for Friday dinner` (the exact plan title),
or reply to a saved chat message containing that plan's canonical details link.
The persisted reply is resolved server-side within the current room. Duplicate
names, conflicting name/link targets, and cross-room links require clarification;
no plan changes. Explicit references to closed plans are rejected rather than
falling through to another active plan. Targeting never changes organizer or
self-consent permissions, revision checks, or retry protection.

The local `create-targets` / `start-targets` scenario creates two simultaneous
plans, obtains model-tool acceptances, and checks ambiguous commands, named
finalization, reply-based withdrawal, organizer permissions, conflicting targets,
reply-based finalization, and references to a cancelled plan. Setup and cancellation
are harness actions; coordination commands use the production agent service.

### Shared lab presentation

The isolated browser lab and main Rooms beta both render `DinnerFrame` and load
the main global and dinner styles. The frame owns the wordmark, responsive sidebar, navigation, and
content frame; main retains Privy authentication while the lab supplies cookie-backed
test identities and disposable data. Lab controls are a collapsed native details
panel. Wallet, activity, and personal-agent lab routes reuse main's components.
This verifies shared presentation, not real Privy login or production deployment.
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


### Combined planning and agent checkout

`codex/combined-plans-agent` reconciles the local planning implementation with the
`tab-coordination` snapshot, including reply-chain provenance, task binding,
bill routing, the responsive dark shell, and Agent settings → View conversation
tests. The report remains a dated historical artifact, not a live runner or a
claim that its saved replies were generated by the combined branch.

Explicit plan commands execute before bill intent classification and do not
continue an unrelated bill task. Planning tools, completed-outing expense links,
versioned consent, and conversation events remain integrated into the newer chat.
Assistant replies use plain text, while recorded test replies retain their
original rendering. Settings obtains account display and sign-out from the shell,
allowing the isolated lab to share it without invoking Privy.

Verification: 243 automated checks passed, TypeScript and ESLint passed, and a
fresh live two-plan scenario passed all seven checks with real participant-model
acceptances. The strengthened two-plan test also rejects any call to the bill
classifier. Browser checks exercised report search/navigation, mobile/desktop
composer visibility, and an actual planning request through the chat UI.
The combined changes are local; this reconciliation did not deploy production.

A live follow-up ("Is Owen coming too?") exposed a cross-plan narrative error:
Nina's Friday withdrawal leaked into a Saturday answer despite correct saved data.
Attendance questions now resolve the nearest saved plan link in the reply chain
and render the current roster/decision facts directly. A regression covers two
plans with different attendance and conflicting name/reply references; all 58
affected agent/planning checks passed after the fix.
