export function isFrameRuntime() {
  return typeof window !== "undefined" && window.parent !== window;
}
