import { distributeToQuotes } from "./distribute-to-quotes";

const castUrl = process.argv[2];
if (!castUrl) {
  console.error("❌ Please provide a cast URL.");
  process.exit(1);
}

async function runForever() {
  while (true) {
    console.log("🔄 Checking for new quote-casts...");

    try {
      await distributeToQuotes(castUrl);
    } catch (err) {
      console.error("❌ Error during run:", err);
    }

    console.log("⏳ Waiting 60 seconds...\n");
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

runForever();
