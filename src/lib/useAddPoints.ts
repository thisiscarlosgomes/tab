export async function useAddPoints(
  address: string,
  action:
    | "pay"
    | "create_tab"
    | "spin"
    | "spin_win"
    | "daily_spin_win"   // ✅ added
    | "send_token"
    | "add_frame"
    | "share_frame",
  tabId?: string,
  splitId?: string
) {
  if (!address || !action) return;

  try {
    await fetch(`/api/points/${address}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, tabId, splitId }),
    });
  } catch (err) {
    console.error("Failed to add points:", err);
  }
}
