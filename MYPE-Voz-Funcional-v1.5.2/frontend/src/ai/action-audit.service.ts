import { BUSINESS_ID, db } from "../database/db";
import type {
  AIActionEnvelope,
  AIActionStatus,
  AIConfirmation,
} from "../types/domain";

export async function saveAIAction(
  action: AIActionEnvelope,
  status?: AIActionStatus,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.aiActions.get(action.id);

  await db.aiActions.put({
    id: action.id,
    businessId: BUSINESS_ID,
    action: action.action,
    originalText: action.originalText,
    dataJson: JSON.stringify(action.data),
    confidence: action.confidence,
    missingFieldsJson: JSON.stringify(action.missingFields),
    warningsJson: JSON.stringify(action.warnings),
    requiresConfirmation: action.requiresConfirmation,
    status:
      status ??
      (action.missingFields.length
        ? "needs_clarification"
        : action.requiresConfirmation
          ? "awaiting_confirmation"
          : "interpreted"),
    userMessage: action.userMessage,
    errorMessage: existing?.errorMessage ?? null,
    createdAt: existing?.createdAt ?? action.createdAt,
    updatedAt: now,
    executedAt: existing?.executedAt ?? null,
  });
}

export async function setAIActionStatus(
  actionId: string,
  status: AIActionStatus,
  options?: { errorMessage?: string | null; executedAt?: string | null },
): Promise<void> {
  await db.aiActions.update(actionId, {
    status,
    errorMessage: options?.errorMessage ?? null,
    executedAt:
      options?.executedAt === undefined
        ? status === "executed"
          ? new Date().toISOString()
          : null
        : options.executedAt,
    updatedAt: new Date().toISOString(),
  });
}

export async function recordAIConfirmation(
  actionId: string,
  decision: "confirmed" | "cancelled",
): Promise<void> {
  const confirmation: AIConfirmation = {
    id: crypto.randomUUID(),
    businessId: BUSINESS_ID,
    actionId,
    decision,
    createdAt: new Date().toISOString(),
  };
  await db.aiConfirmations.add(confirmation);
}
