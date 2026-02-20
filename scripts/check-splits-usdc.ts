import "dotenv/config";
import { MongoClient } from "mongodb";

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();
  const bills = await db.collection("a-split-bill").find({}).toArray();

  const tokens = ["USDC"];
  const thresholds: Record<string, number> = {
    USDC: 1,
    ETH: 0.001,
    EURC: 1,
  };

  const totals: Record<string, number> = { USDC: 0, ETH: 0, EURC: 0 };
  const todays: Record<string, number> = { USDC: 0, ETH: 0, EURC: 0 };
  const paidCounts: Record<string, number> = { USDC: 0, ETH: 0, EURC: 0 };
  const paidTodayCounts: Record<string, number> = { USDC: 0, ETH: 0, EURC: 0 };

  const maxPayments: Record<string, any> = {
    USDC: { amount: 0, name: "", address: "" },
    ETH: { amount: 0, name: "", address: "" },
    EURC: { amount: 0, name: "", address: "" },
  };

  const minPayments: Record<string, any> = {
    USDC: { amount: Infinity, name: "" },
    ETH: { amount: Infinity, name: "" },
    EURC: { amount: Infinity, name: "" },
  };

  const today = new Date().toISOString().slice(0, 10);
  const startOfToday = new Date(`${today}T00:00:00Z`);
  const endOfToday = new Date(`${today}T23:59:59Z`);

  for (const bill of bills) {
    const { token, totalAmount, numPeople, paid } = bill;
    if (!tokens.includes(token) || !Array.isArray(paid) || !totalAmount || !numPeople) continue;

    const perPerson = totalAmount / numPeople;

    for (const entry of paid) {
      if (entry.token !== token || !(entry.timestamp instanceof Date)) continue;

      const amount = typeof entry.amount === "number" ? entry.amount : perPerson;
      if (amount < thresholds[token]) continue;

      totals[token] += amount;
      paidCounts[token]++;

      if (entry.timestamp >= startOfToday && entry.timestamp <= endOfToday) {
        todays[token] += amount;
        paidTodayCounts[token]++;
      }

      if (amount > maxPayments[token].amount) {
        maxPayments[token] = {
          amount,
          name: entry.name || entry.address,
          address: entry.address,
        };
      }

      if (amount < minPayments[token].amount) {
        minPayments[token] = {
          amount,
          name: entry.name || entry.address,
        };
      }
    }
  }

  for (const token of tokens) {
    console.log(`\n🔸 ${token} Payment Summary`);
    console.log(`🧾 Total ${token}: ${totals[token].toFixed(4)}`);
    console.log(`📅 Today ${token} ${todays[token].toFixed(4)}`);
    console.log(`👥 Total Paid: ${paidCounts[token]}`);
    console.log(`📆 Paid Today: ${paidTodayCounts[token]}`);

    if (paidCounts[token] > 0) {
      console.log(`💰 Most Paid: ${maxPayments[token].amount.toFixed(4)} ${token} by ${maxPayments[token].name} (${maxPayments[token].address})`);
      console.log(`💸 Least Paid (≥ min): ${minPayments[token].amount.toFixed(4)} ${token} by ${minPayments[token].name}`);
    } else {
      console.log(`No valid ${token} payments above threshold.`);
    }
  }

    // Top 5 spenders
    console.log(`\n🏆 Top 5 Spenders:`);

    for (const token of tokens) {
      const spenderMap: Record<string, { name: string; amount: number }> = {};
  
      for (const bill of bills) {
        if (bill.token !== token || !Array.isArray(bill.paid)) continue;
  
        const perPerson = bill.totalAmount / bill.numPeople;
  
        for (const entry of bill.paid) {
          if (entry.token !== token || !(entry.timestamp instanceof Date)) continue;
  
          const amount =
            typeof entry.amount === "number" ? entry.amount : perPerson;
          if (amount < thresholds[token]) continue;
  
          const addr = entry.address;
          const name = entry.name || addr;
  
          if (!spenderMap[addr]) {
            spenderMap[addr] = { name, amount };
          } else {
            spenderMap[addr].amount += amount;
          }
        }
      }
  
      const top = Object.entries(spenderMap)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 50);
  
      if (top.length === 0) {
        console.log(`No valid spenders for ${token}.`);
        continue;
      }
  
      console.log(`\n🔹 ${token}`);
      top.forEach(([address, data], i) => {
        console.log(
          `#${i + 1} ${data.name} (${address}) — ${data.amount.toFixed(4)} ${token}`
        );
      });
    }
  

  process.exit();
};

run();
