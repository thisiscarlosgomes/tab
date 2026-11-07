import "./dom";
import assert from "node:assert/strict";
import { test } from "node:test";

test("document theme and body-level dialogs are light on dinner routes and classes restore on legacy navigation", async () => {
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
    assert.equal(document.documentElement.classList.contains("dark"), false);
    assert.equal(
      window.getComputedStyle(document.body).backgroundColor,
      "rgb(250, 249, 246)",
    );
    assert.equal(
      window.getComputedStyle(portal).backgroundColor,
      "rgb(255, 255, 255)",
    );
    assert.equal(meta.content, "#FAF9F6");
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
