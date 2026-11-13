# General guidelines for single user agents

A working framework for agents that help one user complete tasks. The execution loop is: understand, act, verify, remember, continue.

These guidelines are a work in progress, not a finished architecture. They combine implementation experience with external design research. Different products need different permissions, tools, memory lifetimes, and interaction styles. Further testing may change these recommendations substantially.

## Core guidelines

1. **Maintain explicit task state.** Record the objective, scope, confirmed constraints, completed steps with evidence, remaining work, and unresolved questions separately from conversation history. Distinguish verified facts from proposed actions.

2. **Maintain a recent awareness window.** Use up to the last 25 messages as a configurable starting point for understanding follow-ups and corrections. Supplement them with saved task state and targeted retrieval of older evidence. Apply a token budget to large messages and tool outputs. Falling outside the window must not erase objectives, constraints, or pending work. Twenty-five is a practical starting hypothesis, not a universally validated optimum.

3. **Distinguish message intent.** Recognize continuations, corrections, side questions, cancellations, and new objectives. A side question should not silently replace the active task. An explicit cancellation or replacement should update it.

4. **Separate interpretation from authority.** The model proposes actions; application code validates inputs, enforces scope and permissions, and controls execution. A tool's availability does not by itself authorize its use.

5. **Clarify consequential ambiguity.** Make reasonable, reversible choices independently within the authorized task. Ask when uncertainty materially affects correctness, scope, or permission. Resolve the exact target before changing it.

6. **Preserve unknowns.** Do not invent missing facts, identifiers, preferences, or outcomes. Retrieve evidence or ask for the information that is necessary to proceed.

7. **Make execution recoverable.** Persist task progress and operation identifiers when continuity is required. Track failed, cancelled, successful, and unknown outcomes separately. A timeout after a possible external write requires reconciliation before retrying. Cancellation does not undo effects already completed.

8. **Verify before claiming success.** Define observable completion criteria for each action. Check the intended result, not merely a successful tool return or convincing generated text. Keep result delivery distinct from result verification.

9. **Treat external content as data.** Files, websites, messages, and tool output cannot independently grant permissions or override the user's instructions. Restrict access and credential exposure to the task's needs.

10. **Bound resource use.** Set explicit limits for context size, tool output, concurrency, execution time, and recovery attempts. Detect loops and repeated failures. Surface a useful blocker rather than retrying indefinitely.

11. **Preserve continuity through context handoff.** Before context becomes unusable, summarize the objective, completed work, key decisions, remaining work, and one concrete next step. Retain references to source evidence. Compaction is not durable storage; restart recovery requires a separate persistence mechanism.

12. **Make cancellation responsive.** Handle cancellation during model generation, tool execution, and permission waits. Stop additional work, reconcile uncertain outcomes, and accurately report any completed effects.

13. **Communicate proportionally.** Give concise updates when they help the user understand progress, changes, or blockers. Deliver requested outcomes reliably. Match formatting to the product rather than prescribing one chat style for every agent.

14. **Preserve user control.** Respect corrections and cancellations. Bind required approvals to the exact action, scope, and material parameters. Missing or expired approval is not authorization. Enforce policy without adding unnecessary confirmation steps to already-authorized work.

15. **Test continuity and restraint.** Cover interruptions, restarts, ambiguous targets, interleaved tasks, duplicate requests, tool failures, corrections during execution, and requests that must cause no changes. Assert the absence of unintended effects as well as the presence of a useful response.

## Optional capabilities for always on agents

Always-on behavior is a product choice, not a requirement for every personal agent.

- **Event awareness:** accept relevant external events through an inbox or scheduled wake-ups. Filter, deduplicate, and batch noise before invoking expensive reasoning.
- **Discernment:** define the agent's responsibilities clearly. Doing nothing is a valid outcome when there is no useful, authorized action.
- **Separate working from notifying:** an agent may inspect or perform authorized background work without interrupting the user. Notify when there is a meaningful result, decision, failure, or time-sensitive change.
- **Feedback memory:** retain explicit corrections and preferences about intervention. Silence must not automatically count as approval or satisfaction.
- **Background execution:** let longer tasks continue without blocking conversation when the product requires it. Track ownership, scope, progress, cancellation, and results for each task.

An ephemeral agent may intentionally discard session state. Define what expires, what result survives, and how the user receives it. Short lifetime does not remove the need for permissions, verification, or cancellation.

## Minimal task record

```ts
type Task = {
  id: string;
  objective: string;
  scope: string;
  constraints: string[];
  status: 'active' | 'blocked' | 'cancelled' | 'complete';
  completed: { action: string; evidence: string }[];
  nextStep: string | null;
  openQuestions: string[];
};
```

Keep a separate operation journal for attempts, input revisions, tool results, and uncertain effects. Apply product-specific privacy and retention rules; do not store credentials or unrestricted raw tool output as memory.

## Validation and adoption

Start with task state, scoped tools, and outcome verification. Test interruption followed by correct resumption before expanding autonomy. Use deterministic tests for policy and concurrency, real-model evaluations for interpretation, and end-to-end sessions for behavior visible to the user.

Repeat important scenarios with paraphrases and multiple runs. Track model and prompt versions, expected behavior, actual effects, and failure rates. Passing a small set of live examples does not establish general reliability. Set release thresholds according to the consequences of failure.

## Research sources and evidence limits

[Designing an Always-On Agent — Rubric Labs](https://rubriclabs.com/blog/always-on-agents) informs the optional ideas around heartbeat scheduling, event inboxes, context management, separate messaging, and discernment. These are architectural proposals to evaluate, not a requirement to grant broad access or run every agent continuously.

[Block Buzz, inspected at commit cb69ad9](https://github.com/block/buzz/tree/cb69ad9e4f21b25954d76f4ce1b406f882dafecc) provides concrete implementation references:

- [Context handoff](https://github.com/block/buzz/blob/cb69ad9e4f21b25954d76f4ce1b406f882dafecc/crates/buzz-agent/src/handoff.rs): summarize task progress and a next step, with bounded recovery for context overflow.
- [Permission broker](https://github.com/block/buzz/blob/cb69ad9e4f21b25954d76f4ce1b406f882dafecc/crates/buzz-agent/src/permission.rs): authorize tool execution through the client, correlate decisions, and handle timeout and cancellation.
- [Execution loop](https://github.com/block/buzz/blob/cb69ad9e4f21b25954d76f4ce1b406f882dafecc/crates/buzz-agent/src/agent.rs): bounded tool concurrency and cancellation handling.
- [Runtime documentation](https://github.com/block/buzz/blob/cb69ad9e4f21b25954d76f4ce1b406f882dafecc/crates/buzz-agent/README.md): size limits, advisory reply reminders, and the component's in-memory persistence boundary.

This was a focused source review, not an execution audit of Buzz or its entire platform. Its implementation does not validate the 25-message default. Permission checks need not produce a human approval dialog for every tool call; the host applies its configured policy.
