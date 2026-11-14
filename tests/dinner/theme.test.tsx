import "./dom";
import assert from "node:assert/strict";
import { test } from "node:test";

test("document theme and body-level dialogs are dark on dinner routes and classes restore on legacy navigation", async () => {
  const { applyDocumentTheme, isDinnerPath } = await import(
    "../../src/lib/dinner/theme"
  );
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
  const style = document.createElement("style");
  style.textContent = css.slice(css.indexOf("/* Dinner documents"));
  document.head.append(style);
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  document.head.append(meta);
  const portal = document.createElement("div");
  portal.setAttribute("role", "dialog");
  document.body.append(portal);
  try {
    document.documentElement.className = "dark";
    applyDocumentTheme(document, isDinnerPath("/app/rooms/test"));
    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.equal(
      window.getComputedStyle(document.body).backgroundColor,
      "rgb(11, 11, 11)",
    );
    assert.equal(
      window.getComputedStyle(portal).backgroundColor,
      "rgb(27, 27, 27)",
    );
    assert.equal(meta.content, "#0B0B0B");
    applyDocumentTheme(document, isDinnerPath("/wallet"));
    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.equal(
      document.documentElement.classList.contains("dinner-document"),
      false,
    );
    assert.equal(meta.content, "#0A0A14");
    assert.equal(isDinnerPath("/application"), false);
  } finally {
    style.remove();
    meta.remove();
    portal.remove();
  }
});
