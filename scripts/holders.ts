import { writeFileSync } from "fs";
import { parse } from "json2csv";

const TOKEN_ADDRESS = "0x078540eECC8b6d89949c9C7d5e8E91eAb64f6696";
const API_BASE = `https://explorer.zora.energy/api/v2/tokens/${TOKEN_ADDRESS}/holders`;
const OUTPUT_FORMAT: "csv" | "json" = "csv";

type Holder = {
  address: string;
  balance: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllHolders(): Promise<Holder[]> {
  const all: Holder[] = [];
  let cursorParams: Record<string, string | number> | null = null;

  while (true) {
    const url = new URL(API_BASE);
    url.searchParams.set("limit", "100");

    if (cursorParams) {
      url.searchParams.set("address_hash", cursorParams.address_hash as string);
      url.searchParams.set("value", cursorParams.value.toString());
    }

    console.log("Fetching:", url.toString());
    const res = await fetch(url.toString());
    const data = await res.json();

    const items = data?.items || [];
    const filtered = items
      .filter((h: any) => h.value !== "0")
      .map((h: any) => ({
        address: h.address?.hash,
        balance: h.value,
      }));

    all.push(...filtered);

    // Save partial
    writeFileSync("holders_partial.json", JSON.stringify(all, null, 2));
    console.log(`💾 Saved ${all.length} holders so far`);

    // Stop if no more pages
    if (!data.next_page_params) {
      console.log("✅ Done — no more pages");
      break;
    }

    cursorParams = data.next_page_params;
    await delay(300); // Optional throttle
  }

  return all;
}

async function run() {
  const holders = await fetchAllHolders();

  if (!holders.length) {
    console.log("No holders found");
    return;
  }

  if (OUTPUT_FORMAT === "json") {
    writeFileSync("holders.json", JSON.stringify(holders, null, 2));
    console.log(`✅ Saved ${holders.length} holders to holders.json`);
  } else {
    const csv = parse(holders, { fields: ["address", "balance"] });
    writeFileSync("holders.csv", csv);
    console.log(`✅ Saved ${holders.length} holders to holders.csv`);
  }
}

run().catch((err) => {
  console.error("❌ Error:", err);
});
