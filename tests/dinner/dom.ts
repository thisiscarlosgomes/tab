import "./markdown-modules";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  self: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  Event: { value: dom.window.Event, configurable: true },
  CustomEvent: { value: dom.window.CustomEvent, configurable: true },
  NodeFilter: { value: dom.window.NodeFilter, configurable: true },
  HTMLInputElement: { value: dom.window.HTMLInputElement, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  getComputedStyle: { value: dom.window.getComputedStyle, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});
Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
  value() {},
  configurable: true,
});
