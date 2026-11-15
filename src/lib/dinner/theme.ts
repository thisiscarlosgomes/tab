export function isDinnerPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}
export const dinnerTokens = {
  canvas: "#0B0B0B",
  surface: "#1B1B1B",
  ink: "#F1F1F1",
  accent: "#F1F1F1",
  rule: "#2B2B2B",
} as const;
export function applyDocumentTheme(document: Document, dinner: boolean) {
  const root = document.documentElement;
  root.classList.add("dark");
  root.classList.remove("light");
  root.classList.toggle("dinner-document", dinner);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dinner ? dinnerTokens.canvas : "#0A0A14");
}
