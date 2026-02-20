export async function useAddPoints(
  address: string,
  action:
    | "pay"
    | "create_tab"
    | "spin"
    | "spin_win"
    | "daily_spin_win"
    | "send_token"
    | "add_frame"
    | "share_frame"
    | "earn_deposit",
  tabId?: string,
  splitId?: string,
  amount?: number // ✅ NEW
) {
  if (!address || !action) return;

  try {
    await fetch(`/api/points/${address}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, tabId, splitId, amount }), // ✅ include
    });
  } catch (err) {
    console.error("Failed to add points:", err);
  }
}
