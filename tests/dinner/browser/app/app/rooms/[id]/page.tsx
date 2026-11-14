import { Room } from "@/components/dinner/Room";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Room id={(await params).id} />;
}
