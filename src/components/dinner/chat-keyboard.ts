import type { KeyboardEvent } from "react";
/** Shift+Enter adds a line; IME Enter confirms composition without sending. */
export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.keyCode === 229
  )
    return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}
