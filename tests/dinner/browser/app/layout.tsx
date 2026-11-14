import { Fixture } from "./Fixture";
import "@/app/globals.css";
import "@/app/app/dinner.css";
import "./fixture.css";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark dinner-document">
      <body className="select-none antialiased Text/Faint bg-background text-foreground scrollbar-vert">
        <Fixture>{children}</Fixture>
      </body>
    </html>
  );
}
