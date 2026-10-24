import { z } from "zod";
import type { Receipt } from "@countersign/shared";
const schemas: Record<string, z.ZodTypeAny> = {
  "/api/weather": z.object({ city: z.string(), tier: z.string(), tempC: z.number().finite(), conditions: z.string() }),
  "/api/forecast": z.object({ city: z.string(), tier: z.string(), days: z.number().int(), outlook: z.string() }),
  "/api/crypto": z.object({ symbol: z.string(), priceUsd: z.number().nullable(), note: z.string() }),
  "/api/report": z.object({ topic: z.string(), report: z.string().min(1) }),
};
export function checkDelivery(input: { data: unknown; url: string; quotedAtomic: string; paidAtomic?: string }): { status: Receipt["deliveryStatus"]; amountMismatch: boolean; reasons: string[] } {
  const { data } = input;
  const amountMismatch = input.paidAtomic !== undefined && input.paidAtomic !== input.quotedAtomic;
  const reasons: string[] = amountMismatch ? ["paid amount does not match quote"] : [];
  const empty = data == null || data === "" || (typeof data === "object" && Object.keys(data).length === 0);
  const schema = schemas[new URL(input.url).pathname];
  const status = empty ? "empty" : !schema ? "unknown" : !schema.safeParse(data).success || amountMismatch ? "bad_format" : input.paidAtomic === undefined ? "unknown" : "ok";
  if (status !== "ok") reasons.push(`delivery ${status}`);
  return { status, amountMismatch, reasons };
}
