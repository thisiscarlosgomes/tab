import type { Hex } from "viem";
import { Attribution } from "ox/erc8021";

function parseBuilderCodes(input?: string | null): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getConfiguredBuilderCodes(): string[] {
  const clientCodes = process.env.NEXT_PUBLIC_BASE_BUILDER_CODES;
  const serverCodes = process.env.BASE_BUILDER_CODES;
  return parseBuilderCodes(clientCodes || serverCodes);
}

function computeBuilderCodeDataSuffix(): Hex | undefined {
  const codes = getConfiguredBuilderCodes();
  if (!codes.length) return undefined;

  try {
    return Attribution.toDataSuffix({ codes }) as Hex;
  } catch {
    return undefined;
  }
}

export const BUILDER_CODE_DATA_SUFFIX = computeBuilderCodeDataSuffix();

export function appendBuilderCodeToData(data?: Hex): Hex | undefined {
  if (!BUILDER_CODE_DATA_SUFFIX) return data;
  if (!data || data === "0x") return BUILDER_CODE_DATA_SUFFIX;
  return `${data}${BUILDER_CODE_DATA_SUFFIX.slice(2)}` as Hex;
}
