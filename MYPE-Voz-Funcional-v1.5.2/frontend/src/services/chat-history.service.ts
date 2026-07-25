import { BUSINESS_ID, db } from "../database/db";
import {
  AI_ACTION_SCHEMA_VERSION,
  APP_VERSION,
} from "../config/app-version";
import type {
  AIActionEnvelope,
  AIChatMessageRecord,
  AIChatMessageTone,
  AIChatSession,
  AIExecutionResult,
} from "../types/domain";

export const CHAT_WELCOME_MESSAGE =
  "Conversemos sobre tu negocio. Puedes contarme una operación, una preocupación o una idea; también puedo analizar tus datos, explicarte resultados y recomendar próximos pasos. Si algo modifica el negocio, te mostraré el resumen antes de guardarlo.";

const DEFAULT_CHAT_TITLE = "Nueva conversación";

interface AppendChatMessageInput {
  role: "assistant" | "user";
  text?: string;
  tone?: AIChatMessageTone;
  action?: AIActionEnvelope;
  actionDecision?: "confirmed" | "cancelled";
  result?: AIExecutionResult;
  quickReplies?: string[];
  source?: "gemma" | "local-rules";
  model?: string;
  preview?: string;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shorten(value: string, maximum: number): string {
  const text = compactText(value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function normalizedTitleText(value: string): string {
  return compactText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function isGenericConversationTitle(value: string): boolean {
  const normalized = normalizedTitleText(value);

  return (
    normalized === "hola" ||
    normalized === "holi" ||
    normalized === "buenas" ||
    normalized === "como estas" ||
    normalized === "que tal" ||
    normalized === "gracias" ||
    normalized === "muchas gracias" ||
    normalized === "nueva conversacion"
  );
}

function titleFromUserMessage(value: string): string {
  const cleaned = compactText(value)
    .replace(/[.!?]+$/g, "")
    .trim();

  if (!cleaned || isGenericConversationTitle(cleaned)) {
    return DEFAULT_CHAT_TITLE;
  }

  return shorten(cleaned, 48);
}

function previewFromMessage(input: AppendChatMessageInput): string {
  if (input.preview?.trim()) return shorten(input.preview, 85);
  if (input.text?.trim()) return shorten(input.text, 85);
  if (input.result) {
    return shorten(`${input.result.title}: ${input.result.message}`, 85);
  }
  if (input.action) {
    return shorten(input.action.userMessage, 85);
  }
  return "Actividad reciente";
}

export async function createChatSession(): Promise<AIChatSession> {
  const now = new Date().toISOString();
  const session: AIChatSession = {
    id: crypto.randomUUID(),
    businessId: BUSINESS_ID,
    title: DEFAULT_CHAT_TITLE,
    preview: "Inicia una conversación sobre tu negocio.",
    pendingActionJson: null,
    pendingActionVersion: null,
    createdAt: now,
    updatedAt: now,
  };

  const welcome: AIChatMessageRecord = {
    id: crypto.randomUUID(),
    businessId: BUSINESS_ID,
    sessionId: session.id,
    role: "assistant",
    text: CHAT_WELCOME_MESSAGE,
    tone: "normal",
    actionJson: null,
    actionDecision: null,
    resultJson: null,
    quickRepliesJson: null,
    source: null,
    model: null,
    createdAt: now,
  };

  await db.transaction(
    "rw",
    [db.aiChatSessions, db.aiChatMessages],
    async () => {
      await db.aiChatSessions.add(session);
      await db.aiChatMessages.add(welcome);
    },
  );

  return session;
}

export async function ensureChatSession(
  preferredId?: string | null,
): Promise<AIChatSession> {
  if (preferredId) {
    const preferred = await db.aiChatSessions.get(preferredId);
    if (preferred) return preferred;
  }

  const latest = await db.aiChatSessions
    .orderBy("updatedAt")
    .reverse()
    .first();

  return latest ?? createChatSession();
}

export async function appendChatMessage(
  sessionId: string,
  input: AppendChatMessageInput,
): Promise<AIChatMessageRecord> {
  const now = new Date().toISOString();
  const record: AIChatMessageRecord = {
    id: crypto.randomUUID(),
    businessId: BUSINESS_ID,
    sessionId,
    role: input.role,
    text: input.text?.trim() || null,
    tone: input.tone ?? "normal",
    actionJson: input.action ? JSON.stringify(input.action) : null,
    actionDecision: input.actionDecision ?? null,
    resultJson: input.result ? JSON.stringify(input.result) : null,
    quickRepliesJson: input.quickReplies?.length
      ? JSON.stringify(input.quickReplies)
      : null,
    source: input.source ?? null,
    model: input.model ?? null,
    createdAt: now,
  };

  await db.transaction(
    "rw",
    [db.aiChatSessions, db.aiChatMessages],
    async () => {
      const session = await db.aiChatSessions.get(sessionId);
      if (!session) {
        throw new Error("La conversación ya no existe.");
      }

      const titleCandidate =
        input.role === "user" && input.text
          ? titleFromUserMessage(input.text)
          : DEFAULT_CHAT_TITLE;

      const replaceableTitle =
        session.title === DEFAULT_CHAT_TITLE ||
        isGenericConversationTitle(session.title);

      const nextTitle =
        input.role === "user" &&
        replaceableTitle &&
        titleCandidate !== DEFAULT_CHAT_TITLE
          ? titleCandidate
          : session.title;

      await db.aiChatMessages.add(record);
      await db.aiChatSessions.update(sessionId, {
        title: nextTitle,
        preview: previewFromMessage(input),
        updatedAt: now,
      });
    },
  );

  return record;
}

export async function updateChatMessage(
  messageId: string,
  patch: Partial<
    Pick<
      AIChatMessageRecord,
      "actionDecision" | "tone" | "text" | "actionJson" | "resultJson"
    >
  >,
): Promise<void> {
  await db.aiChatMessages.update(messageId, patch);
}

export async function setChatSessionPendingAction(
  sessionId: string,
  action: AIActionEnvelope | null,
): Promise<void> {
  await db.aiChatSessions.update(sessionId, {
    pendingActionJson: action ? JSON.stringify(action) : null,
    pendingActionVersion: action
      ? AI_ACTION_SCHEMA_VERSION
      : null,
    updatedAt: new Date().toISOString(),
  });
}


function actionIdFromJson(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

export async function invalidateStalePendingActions(): Promise<{
  invalidatedSessions: string[];
}> {
  const sessions = await db.aiChatSessions.toArray();
  const staleSessions = sessions.filter(
    (session) =>
      Boolean(session.pendingActionJson) &&
      session.pendingActionVersion !== AI_ACTION_SCHEMA_VERSION,
  );

  if (!staleSessions.length) {
    return { invalidatedSessions: [] };
  }

  const now = new Date().toISOString();

  await db.transaction(
    "rw",
    [db.aiChatSessions, db.aiChatMessages],
    async () => {
      for (const session of staleSessions) {
        const pendingActionId = actionIdFromJson(
          session.pendingActionJson,
        );

        if (pendingActionId) {
          const messages = await db.aiChatMessages
            .where("sessionId")
            .equals(session.id)
            .toArray();

          const pendingMessage = messages
            .filter(
              (message) =>
                message.actionDecision === null &&
                message.actionJson?.includes(pendingActionId),
            )
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt),
            )[0];

          if (pendingMessage) {
            await db.aiChatMessages.update(pendingMessage.id, {
              actionDecision: "cancelled",
              tone: "warning",
            });
          }
        }

        const notice: AIChatMessageRecord = {
          id: crypto.randomUUID(),
          businessId: BUSINESS_ID,
          sessionId: session.id,
          role: "assistant",
          text:
            `La operación pendiente fue creada por una versión anterior y no se ejecutó. ` +
            `Se descartó para evitar reutilizar datos incorrectos. Vuelve a escribirla cuando desees registrarla.`,
          tone: "warning",
          actionJson: null,
          actionDecision: null,
          resultJson: null,
          quickRepliesJson: JSON.stringify([
            "Volver a escribir la operación",
            "Crear un chat nuevo",
          ]),
          source: null,
          model: null,
          createdAt: now,
        };

        await db.aiChatMessages.add(notice);
        await db.aiChatSessions.update(session.id, {
          pendingActionJson: null,
          pendingActionVersion: null,
          preview:
            `Operación antigua descartada al actualizar a v${APP_VERSION}.`,
          updatedAt: now,
        });
      }
    },
  );

  return {
    invalidatedSessions: staleSessions.map(
      (session) => session.id,
    ),
  };
}

export async function renameChatSession(
  sessionId: string,
  title: string,
): Promise<void> {
  const cleanTitle = shorten(title, 55);
  if (!cleanTitle) return;

  await db.aiChatSessions.update(sessionId, {
    title: cleanTitle,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteChatSession(
  sessionId: string,
): Promise<void> {
  await db.transaction(
    "rw",
    [db.aiChatSessions, db.aiChatMessages],
    async () => {
      await db.aiChatMessages
        .where("sessionId")
        .equals(sessionId)
        .delete();
      await db.aiChatSessions.delete(sessionId);
    },
  );
}
