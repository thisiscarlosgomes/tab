import { parseUsd } from "../model";

/** Names/amounts are lookup hints; stable IDs remain the identity. Never pick a first match. */
export function matchingBills<T extends { description: string; totalCents: number | null }>(text: string, bills: T[]): T[] | null {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = ` ${normalize(text)} `;
  const named = bills.filter(bill => {
    const name = normalize(bill.description);
    return name.length >= 3 && !["receipt", "bill", "expense"].includes(name) && words.includes(` ${name} `);
  });
  const amounts = [...text.matchAll(/(?:\$\s*|\bUSD\s*)(\d+(?:\.\d{1,2})?)(?![\d.])/gi)].map(match => parseUsd(match[1]));
  if (!named.length && !amounts.length) return null;
  return (named.length ? named : bills).filter(bill => !amounts.length || amounts.includes(bill.totalCents));
}
