import { RoomView, usd } from "./model";
export function outsideActivity(room: RoomView) {
  return room.expenses.flatMap((expense) =>
    expense.status !== "confirmed"
      ? []
      : expense.obligations.flatMap((obligation) =>
          (obligation.outsideReports ?? []).flatMap((report) => {
            const base = {
              roomId: room.id,
              detail: `${room.name} · ${expense.description} · ${usd(report.cents)} · No Tab transfer or payment receipt`,
            };
            const created = {
              ...base,
              id: `outside-${report.id}`,
              title: "Reported paid outside Tab",
              at: report.createdAt,
            };
            return report.status === "pending"
              ? [created]
              : [
                  created,
                  {
                    ...base,
                    id: `outside-${report.id}-${report.status}`,
                    title:
                      report.status === "confirmed"
                        ? "Recipient confirmed receipt outside Tab"
                        : report.status === "rejected"
                          ? "Outside report rejected · still outstanding"
                          : "Outside report cancelled · still outstanding",
                    at: report.resolvedAt,
                  },
                ];
          }),
        ),
  );
}
export function pendingOutside(rooms: RoomView[], userId: string) {
  return rooms.flatMap((room) =>
    room.expenses.flatMap((expense) =>
      expense.status !== "confirmed"
        ? []
        : expense.obligations.flatMap((obligation) =>
            obligation.status !== "outstanding"
              ? []
              : (obligation.outsideReports ?? [])
                  .filter(
                    (r) =>
                      r.status === "pending" &&
                      [
                        obligation.debtorId,
                        obligation.creditorId,
                        expense.creatorId,
                        r.reportedBy,
                      ].includes(userId),
                  )
                  .map((report) => ({
                    roomId: room.id,
                    roomName: room.name,
                    description: expense.description,
                    reportId: report.id,
                    cents: obligation.cents,
                    needsConfirmation: obligation.creditorId === userId,
                    recipient:
                      room.members.find(
                        (m) => m.userId === obligation.creditorId,
                      )?.name ?? "the recipient",
                  })),
          ),
    ),
  );
}
