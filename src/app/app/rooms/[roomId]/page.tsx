import { Room } from "@/components/dinner/Room";
export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  return <Room id={(await params).roomId} />;
}
