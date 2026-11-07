export function isDinnerPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}
export const dinnerTokens = {
  canvas: "#FAF9F6",
  surface: "#FFFFFF",
  ink: "#18211D",
  accent: "#2F704D",
  rule: "#E5E7E1",
} as const;
export function applyDocumentTheme(document: Document, dinner: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", !dinner);
  root.classList.toggle("light", dinner);
  root.classList.toggle("dinner-document", dinner);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dinner ? dinnerTokens.canvas : "#0A0A14");
}
