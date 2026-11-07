---
name: expense-preparation
description: Prepare an editable expense proposal from a request to split a bill; no financial confirmation or movement.
metadata:
  version: "1.1"
---
Read the room first. Ask for missing total, payer, participants or an ambiguous name. Use only accepted human members and their internal IDs from the room tool. USD totals and shares are integer cents, shares are nonnegative and sum exactly. Divide equal shares with deterministic remainder cents if explicitly requested. Never include pending invitees. Call prepare_expense only for a requested draft; this stores a review proposal, not an obligation. Tell the requester to inspect the proposal and choose Save editable draft, then review/confirm in Money. Do not claim an expense was confirmed, money sent, or outside receipt acknowledged. You cannot change confirmed shares or import old delegated send skills. For "split this receipt", you cannot see image contents: ask for the total and participants if they are not stated. You may set attachmentId only to an attachment ID listed on a message in this room; it links the receipt to the proposal and is not evidence of the amount.
