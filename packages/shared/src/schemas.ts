import { z } from "zod";

export const PlanItemSchema = z.object({
  category: z.string().min(1),
  maxUnitUsd: z.number().positive(),
  maxQuantity: z.number().int().positive(),
  vendorDomains: z.array(z.string().min(1)).min(1),
  tiers: z.array(z.string().min(1)).optional(),
});

export const PlanInputSchema = z.object({
  goal: z.string().min(1),
  expected: z.array(PlanItemSchema).min(1),
});

export const CreateTaskSchema = z.object({
  text: z.string().min(1),
  budgetUsd: z.number().positive(),
  taskType: z.string().min(1),
});

export const DeclarePlanSchema = z.object({ taskId: z.string().min(1), plan: PlanInputSchema });

export const FetchUrlSchema = z.object({ taskId: z.string().min(1), url: z.string().url() });

export const PaymentRequestSchema = z.object({
  url: z.string().url(),
  payeeDomain: z.string().min(1),
  amountUsd: z.number().nonnegative(),
  tier: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  purpose: z.string(),
});

export const PayAndFetchSchema = z.object({ taskId: z.string().min(1), req: PaymentRequestSchema });

export type PlanInput = z.infer<typeof PlanInputSchema>;
