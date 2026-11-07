import { notFound } from "next/navigation";
import { DinnerShell } from "@/components/dinner/DinnerShell";
import "./dinner.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Rooms beta",
  description: "Bring your people. Make a plan. Keep a shared tab.",
  robots: { index: false, follow: false },
};
export default function DinnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.DINNER_ROOMS_ENABLED !== "true") notFound();
  return <DinnerShell>{children}</DinnerShell>;
}
