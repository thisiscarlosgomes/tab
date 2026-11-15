import "./dom";
import React from "react";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, cleanup, waitFor } from "@testing-library/react";
import { MessageText } from "../../src/components/dinner/MessageText";

afterEach(cleanup);

test("saved chat renders bold, emphasis, lists and code as Markdown", async () => {
  const { container } = render(<MessageText text={'In your rooms:\n\n1. **Friday Dinner by tab**: You are owed *$0.50*.\n2. **Friday Dinner**: No one owes anything.\n\n- First item\n- Second item\n\n`code`'} />);
  await waitFor(() => assert.equal(container.querySelector("strong")?.textContent, "Friday Dinner by tab"));
  assert.equal(container.querySelector("em")?.textContent, "$0.50");
  assert.equal(container.querySelectorAll("ol > li").length, 2);
  assert.equal(container.querySelectorAll("ul > li").length, 2);
  assert.equal(container.querySelector("code")?.textContent, "code");
});

test("streaming Markdown handles unfinished bold and then the completed reply", async () => {
  const view = render(<MessageText text="**Friday Dinner" streaming />);
  await waitFor(() => assert.equal(view.container.querySelector("strong")?.textContent, "Friday Dinner"));
  view.rerender(<MessageText text="**Friday Dinner**: $0.50" />);
  assert.equal(view.container.querySelectorAll("strong").length, 1);
  assert.ok(view.container.textContent?.includes("$0.50"));
});

test("chat Markdown cannot inject HTML, scripts or remote images", async () => {
  const { container } = render(<MessageText text={'<script>alert(1)</script>\n\n<img src="https://example.com/tracker" onerror="alert(1)">\n\n![tracking](https://example.com/image.png)\n\n[unsafe](javascript:alert%281%29)'} />);
  await waitFor(() => assert.ok(container.querySelector(".chat-markdown")));
  assert.equal(container.querySelector("script,img,iframe"), null);
  assert.ok(!container.querySelector('a[href^="javascript:"]'));
});
