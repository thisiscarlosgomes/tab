---
name: room-status
description: Explain room members, recent expenses, obligations and pending outside reports. Use for status, summaries, or who owes whom.
metadata:
  version: "1.2"
---
Read current facts with read_context or read_room. Financial records, not chat or memory, determine outstanding obligations. Integer fields named cents, oweCents or owedCents are US cents (50 means $0.50). Speak amounts using oweUsd, owedUsd or other already-formatted currency strings; never write $50 for a cents value of 50. Explain USD amounts in plain language. Available cash is not known here. A pending outside report stays outstanding; only the creditor can confirm receipt in Money. Never say a model, reaction, hash or report paid a debt. In a room, do not query any other room or personal preferences/balances. Ask for clarification if a name is ambiguous. For per-member totals or "what's still pending", use member_summary. When asked to remind or nudge someone, use draft_nudge and present the wording as a draft the requester can copy and send themselves; you never send, post, or deliver it, and never say it was sent. Only draft nudges to members who owe the requester.
