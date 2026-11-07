# Dinner-room coordination beta

## Boundaries and chosen design

The legacy root Providers continue to own Privy/X login and OAuth persistence. AppShell bypasses only its legacy navigation/redirects for `/app`; legacy `/rooms`, `/r`, games, splits, activity, yield and jackpot remain reachable, with no legacy document migration. The dinner server verifies Privy identity independently on every request, then maps the verified Privy ID to a unique internal UUID. No request body can choose its actor. X subject binding comes only from the verified provider user, not a handle or wallet.

Considered separate collections with multi-document transactions versus a bounded room aggregate with compare-and-swap. Chosen: a room aggregate containing membership, invitations, ordered messages, expenses and read cursors. Mongo revision CAS atomically commits invitation acceptance plus membership and confirmed expenses plus immutable obligations. It requires no replica-set transactions and makes retry behavior testable against real Mongo. Limits (50 members, 100 invitations, 1,000 messages, 200 expenses per room) deliberately keep documents small for this beta. Exceeding them returns a clear error rather than silently dropping history. Extract append-only collections with transactional outbox before lifting limits.

Private raster attachments live in a separate collection, limited to 2 MB per upload, re-encoded to WebP with sharp (no SVG, metadata or original active content served), with authenticated membership checks on upload/download. Receipt AI extraction is not necessary for the beta; entered expense fields remain editable until confirmation. No conversation goes to an assistant. Attachments are capped per room; uploaded-but-unused files count toward that limit.

UI calls a small authenticated API. Persisted polling/cursor catch-up every three seconds (and on visibility/online) is the beta transport. The server is authoritative; sent means persisted. Repeating a client retry ID with changed content fails with 409. Expense confirmation is a state transition, not a payment. Activities derive from persisted room/membership/expense state, not best-effort financial writes.

## Local setup

Node 22 recommended; `npm ci`; set `MONGODB_URI`, `NEXT_PUBLIC_PRIVY_APP_ID`, and `PRIVY_APP_SECRET` using your existing Privy app; set `DINNER_ROOMS_ENABLED=true`. `npm run dev`, open `/app`. X login must be enabled in the existing Privy app; existing X graph configuration is optional for sharing single-person invite links. No new bank, wallet, blob or assistant key is required.

`npm test` starts a disposable real Mongo via mongodb-memory-server, no application credentials needed. First run downloads a MongoDB test binary. `npm run typecheck` checks the repository; `npm run lint` checks the repository with ESLint. `npm run verify:dinner` runs all three. Never point test fixtures at a production DB.

## Try it with two people

1. Enable the flag, sign in at `/app`, create Friday Dinner with a purpose.
2. Create a single-person invite link (or choose an X following identity and copy its bound link). Share it manually. A second account previews, signs in, and explicitly joins. Joining creates no obligation or spending authority.
3. Chat, reply/react, attach a raster receipt, refresh or disconnect/reconnect and retry a failed send. Read state is server-backed.
4. Add an expense, choose a payer and accepted participants, edit shares in USD, save the draft, review and confirm. Check Money and Activity. A recipient can flag their share.
5. Add another expense in the same room. There are no payment/settle buttons and no cash balance. Legacy wallet remains reachable through a secondary link.

## Gates and deliberate exclusions

No live provider login/graph assertion is made by automated tests. Test Privy redirects and two real accounts on staging before expanding the beta. Existing legacy origin-only authorization gaps are not fixed by this isolated slice; do not interpret new API safety as an audit of old payment routes. No member removal, archival/deletion, expense amendment after confirmation, settlement, pots, refunds, push notifications, assistant processing, agent execution or financial custody in this slice. Disputed shares remain visible and outstanding, never silently removed or marked paid. Use a new expense for a correction only after discussing it; editing confirmed expenses needs a versioned adjustment design later.

## Verification scope

The suite exercises the real Mongo compare-and-swap store (not an in-memory repository mock), HTTP authorization/response contracts, and DOM-driven expense/chat flows through that HTTP/store path. The DOM harness supplies a test actor at the authenticated boundary; it does not bypass authentication in the application. A real Privy/X sign-in and visual desktop/mobile review still require a configured staging Privy app. No production database or real financial action is used by tests.

The pre-existing whole-repository compiler/lint failures were repaired with narrow wire-field types, SDK argument/null guards, and profile parsing (no checks disabled). The existing Verify workflow still depends on a Dockerfile absent from main. Workflow repairs require repository workflow permission and are not part of this PR; run `npm run verify:dinner` for full source/test lint, typecheck and tests without deployment secrets. The new slice does not make existing legacy payment authorization safe; that remains a separate audit.


## Verified results

47 tests pass (43 domain/HTTP/Mongo contracts and four DOM expense/chat flows), full TypeScript passes including Next-generated route checks, and source/test ESLint passes with no warnings. A production build also completes with synthetic build-only provider/signer fixtures and localhost-only Mongo/RPC endpoints; this proves compilation and prerendering, not provider connectivity. Whole-app builds still require the legacy `ENCRYPTION_KEY` (32 characters), `PRIVATE_KEY`, and RPC configuration in addition to Privy/Mongo; this is not new dinner-room configuration. Never reuse production signing keys for test builds.
