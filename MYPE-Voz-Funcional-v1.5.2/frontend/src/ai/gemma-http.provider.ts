import type { AIActionEnvelope } from "../types/domain";
import type { AIProvider, AIProviderContext } from "./provider";

export const NEGOCIO_IA_APP_VERSION = "2.5.2";

export interface GemmaConnectionStatus {
  connected: boolean;
  modelInstalled: boolean;
  model: string;
  provider: string;
  appVersion?: string;
  processId?: number;
  versionCompatible: boolean;
  installedModels?: string[];
  error?: string;
}

export type AIClarificationOutcome =
  | {
      kind: "updated_action";
      action: AIActionEnvelope;
      message: string;
    }
  | {
      kind: "assistant_message";
      message: string;
    }
  | {
      kind: "cancel";
      message: string;
    };

function serializeContext(context: AIProviderContext) {
  return {
    products: context.products.map((product) => ({
      id: product.id,
      name: product.name,
      type: product.type,
      purchaseCost: product.purchaseCost,
      salePrice: product.salePrice,
      tracksStock: product.tracksStock,
      currentStock: product.currentStock,
      minimumStock: product.minimumStock,
    })),
    customers: context.customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
    })),
    pendingDebts: context.debts
      .filter((debt) => debt.status === "pending" && debt.balance > 0)
      .map((debt) => ({
        id: debt.id,
        customerId: debt.customerId,
        balance: debt.balance,
        createdAt: debt.createdAt,
      })),
    recentOperations: context.recentOperations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      title: operation.title,
      summary: operation.summary,
      amount: operation.amount,
      paymentMethod: operation.paymentMethod,
      createdAt: operation.createdAt,
      status: operation.status,
      reversible: operation.reversible,
      reversalReason: operation.reversalReason,
    })),
    businessSnapshot: context.businessSnapshot,
    conversationHistory: context.conversationHistory.slice(-16),
    operationalHistory: context.operationalHistory.slice(-8),
  };
}

class IncompatibleServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleServerError";
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;
  return payload?.message ?? "Gemma no pudo procesar la solicitud.";
}

export async function getGemmaConnectionStatus(): Promise<GemmaConnectionStatus> {
  try {
    const response = await fetch("/api/ai/status", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("El servidor de IA no respondió.");
    }

    const payload = (await response.json()) as Omit<
      GemmaConnectionStatus,
      "versionCompatible"
    >;

    const versionCompatible =
      payload.appVersion === NEGOCIO_IA_APP_VERSION;

    return {
      ...payload,
      versionCompatible,
      error: versionCompatible
        ? payload.error
        : `El frontend es v${NEGOCIO_IA_APP_VERSION}, pero el servidor activo es ${
            payload.appVersion
              ? `v${payload.appVersion}`
              : "de una versión antigua"
          }.`,
    };
  } catch (error) {
    return {
      connected: false,
      modelInstalled: false,
      model: "gemma3:4b",
      provider: "ollama",
      versionCompatible: false,
      error:
        error instanceof Error
          ? error.message
          : "El servidor de IA no está disponible.",
    };
  }
}

async function assertCompatibleServer(): Promise<void> {
  const status = await getGemmaConnectionStatus();

  if (!status.versionCompatible) {
    throw new IncompatibleServerError(
      status.error ??
        "El frontend y el servidor de IA pertenecen a versiones diferentes.",
    );
  }
}

export class GemmaHttpProvider implements AIProvider {
  readonly name = "Gemma local";
  readonly mode = "gemma" as const;
  private usedFallback = false;

  constructor(
    private readonly endpoint: string,
    private readonly fallback?: AIProvider,
  ) {}

  get lastInterpretationUsedFallback(): boolean {
    return this.usedFallback;
  }

  async interpret(
    text: string,
    context: AIProviderContext,
  ): Promise<AIActionEnvelope> {
    this.usedFallback = false;

    try {
      await assertCompatibleServer();

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...serializeContext(context),
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const action = (await response.json()) as AIActionEnvelope;
      return {
        ...action,
        source: "gemma",
        model: action.model ?? "gemma3:4b",
      };
    } catch (error) {
      if (error instanceof IncompatibleServerError) {
        throw error;
      }

      if (!this.fallback) throw error;

      this.usedFallback = true;
      const action = await this.fallback.interpret(text, context);
      return {
        ...action,
        source: "local-rules",
        confidence: Math.min(action.confidence, 0.82),
        warnings: [
          "Gemma no estaba disponible; esta interpretación fue realizada por el controlador local de respaldo.",
          ...action.warnings,
        ],
      };
    }
  }

  async clarify(
    pendingAction: AIActionEnvelope,
    answer: string,
    context: AIProviderContext,
  ): Promise<AIClarificationOutcome> {
    await assertCompatibleServer();

    const response = await fetch("/api/ai/clarify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answer,
        pendingAction,
        ...serializeContext(context),
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const outcome = (await response.json()) as AIClarificationOutcome;
    if (outcome.kind === "updated_action") {
      return {
        ...outcome,
        action: {
          ...outcome.action,
          source: "gemma",
          model: outcome.action.model ?? "gemma3:4b",
        },
      };
    }
    return outcome;
  }
}
