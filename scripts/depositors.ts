import clientPromise from "@/lib/mongodb";

// Set date from June 9 (00:00 UTC)
const START_DATE = new Date("2024-06-17T00:00:00Z");
const NUM_WINNERS = 2;

async function pickWinners() {
  const client = await clientPromise;
  const db = client.db();
  const deposits = db.collection("a-jackpot-deposit");

  // Fetch all deposits since 6/9
  const allDeposits = await deposits
    .find({ timestamp: { $gte: START_DATE } })
    .toArray();

  if (allDeposits.length === 0) {
    console.log("❌ No deposits found after 6/9.");
    return;
  }

  // Optional: Filter for unique addresses or fids
  const uniqueMap = new Map<string, any>();
  for (const dep of allDeposits) {
    if (!uniqueMap.has(dep.address)) {
      uniqueMap.set(dep.address, dep);
    }
  }

  const uniqueDeposits = Array.from(uniqueMap.values());

  // Shuffle and pick N winners
  const shuffled = uniqueDeposits.sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, NUM_WINNERS);

  console.log(`🎉 Picked ${NUM_WINNERS} random depositors since 6/9:`);
  winners.forEach((w, i) => {
    console.log(`\n#${i + 1}`);
    console.log(`FID: ${w.fid}`);
    console.log(`Address: ${w.address}`);
    console.log(`Amount: ${w.amount}`);
    console.log(`Ticket Count: ${w.ticketCount}`);
    console.log(`Timestamp: ${w.timestamp}`);
  });
}

pickWinners()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error picking winners:", err);
    process.exit(1);
  });
