import type {
  AIActionEnvelope,
  AIConversationTurn,
  BusinessConversationSnapshot,
  Customer,
  Debt,
  Product,
  RecentBusinessOperation,
} from "../types/domain";

export interface AIProviderContext {
  products: Product[];
  customers: Customer[];
  debts: Debt[];
  recentOperations: RecentBusinessOperation[];
  businessSnapshot: BusinessConversationSnapshot;
  conversationHistory: AIConversationTurn[];
  operationalHistory: string[];
}

export interface AIProvider {
  readonly name: string;
  readonly mode: "local-rules" | "gemma";
  interpret(
    text: string,
    context: AIProviderContext,
  ): Promise<AIActionEnvelope>;
}
