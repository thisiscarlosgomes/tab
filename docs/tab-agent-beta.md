# Try the Tab coordination agent

Use two accepted members to test a real shared obligation. A one-person room creates no debt to its payer.

## Start locally

1. Run `npm ci` in the repository.
2. Keep the existing local Mongo, Privy/X, and legacy whole-app environment configuration. Do not add secrets to Git.
3. Set `DINNER_ROOMS_ENABLED=true` in your local environment.
4. To enable generated replies and natural-language expense proposals, set the existing `OPENAI_API_KEY`. The optional `OPENAI_CHAT_MODEL` defaults to `gpt-4o-mini`. No key gives verified status summaries, not generated drafts.
5. Run `npm run dev`.
6. Open `http://localhost:3000/app` and sign in.

## Ask Tab in a room

1. Open or create Friday Dinner. Invite a second account and accept from that account.
2. Send an ordinary message. Tab does not reply.
3. Send `@Tab who owes whom?`. The member message saves first. A distinct Tab reply then appears in the shared thread.
4. With generation configured, ask `@Tab prepare a $50.01 dinner split, paid by Alice, equally between Alice and Bob`. Use your actual member names.
5. Inspect the proposed payer, total, and exact-cent shares. Choose **Save editable draft**.
6. Open **Money**. Edit the draft if needed, then explicitly review and confirm it. The proposal alone creates no obligation.
7. As the debtor, choose **Report paid outside Tab** after an actual outside payment. The share remains outstanding until the creditor explicitly reviews and confirms receipt in Money.
8. Add a second expense in the same room. The conversation and earlier records remain.

If generation fails, use **Ask Tab to reply** on the saved addressed message. Do not resend it to retry a reply. A crashed active run can need 70 seconds before its lease becomes retryable.

## Open your money home and private agent

1. Open `http://localhost:3000/app/wallet` or choose **Wallet** in the dinner navigation.
2. Inspect **You owe**, **Owed to you**, and pending reports. Use a room link to review obligations. **Available** is not connected; disabled funding controls do not move money.
3. Open `http://localhost:3000/app/agent` using **Ask Tab** in the header.
4. Ask for your outstanding obligations or pending outside reports. Refresh and check that the saved conversation returns.
5. Save an explicit preference such as `Keep replies brief` in the memory editor. Edit or remove it there. Group prompts never load this personal preference.
6. With generation configured, request a draft for one of your rooms. Choose **Save editable draft** before the room receives the financial draft. Confirm only after reviewing Money.

## Save agreements and a private reminder

1. Open a room's **Plan** tab.
2. Save a shared agreement. Another accepted member can read and edit it. A stale edit receives a refresh warning rather than overwriting a newer version.
3. Save a useful shared planning note in room memory. Do not enter private account or funding details.
4. Enter a private reminder and a future time. The form uses your device's time zone.
5. Open **Today**. The reminder appears under **Just for you** until dismissed. Only its creator sees it. There is no push notification or action while the app is closed.

## Verify without production services

Run `npm run verify:dinner` for typecheck, source/test lint, and disposable Mongo/DOM tests. Do not point tests at production Mongo.

After a production build, run `npm run test:agent-trace` to verify that all three skill files are packaged for deployment.

After starting the app, run `npm run test:theme-http`. Set `DINNER_THEME_SMOKE_URL` if the server is not on localhost:3000. The theme gate checks dinner server-rendered documents and preserved legacy dark routes, without logging in.

See [the agent design and verification limits](tab-agent.md) before expanding the beta.
