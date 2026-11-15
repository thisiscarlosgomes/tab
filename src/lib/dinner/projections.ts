import { RoomView, usd, memberName } from "./model";
export function outsideActivity(room: RoomView) {
  return room.expenses.flatMap((expense) =>
    expense.status !== "confirmed"
      ? []
      : [
          ...(expense.history ?? []).flatMap((h) => h.obligations),
          ...expense.obligations,
        ].flatMap((obligation) =>
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
                    recipient: memberName(room, obligation.creditorId),
                  })),
          ),
    ),
  );
}

export function coordinationActivity(room: RoomView) {
  return [
    ...(room.removals ?? []).map((m) => ({
      id: m.id,
      roomId: room.id,
      title: `${m.name} removed from room`,
      detail: "Financial history and obligations preserved",
      at: m.removedAt,
    })),
    ...room.expenses.flatMap((e) =>
      e.status !== "confirmed"
        ? []
        : (e.corrections ?? []).map((c) => ({
            id: c.id,
            roomId: room.id,
            title: `Expense correction ${c.status} · ${c.fields.description}`,
            detail: `${usd(c.fields.totalCents)} · ${c.status === "applied" ? "Version recorded; no payment" : "Balances unchanged"}`,
            at: c.appliedAt ?? c.createdAt,
          })),
    ),
  ];
}
