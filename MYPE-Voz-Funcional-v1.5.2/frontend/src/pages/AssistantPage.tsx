import { useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../database/db";
import { AI_ACTION_SCHEMA_VERSION } from "../config/app-version";
import { getRecentBusinessOperations } from "../services/operation.service";
import {
  EMPTY_BUSINESS_SNAPSHOT,
  getBusinessConversationSnapshot,
} from "../services/business-context.service";
import {
  appendChatMessage,
  createChatSession,
  deleteChatSession,
  ensureChatSession,
  invalidateStalePendingActions,
  renameChatSession,
  setChatSessionPendingAction,
  updateChatMessage,
} from "../services/chat-history.service";
import {
  actionPreviewRows,
  actionTitle,
} from "../ai/action-description";
import {
  cancelAIAction,
  executeAIAction,
} from "../ai/action-executor.service";
import { saveAIAction } from "../ai/action-audit.service";
import {
  applyClarification,
  clarificationQuestion,
} from "../ai/clarification.service";
import {
  GemmaHttpProvider,
  getGemmaConnectionStatus,
  type GemmaConnectionStatus,
} from "../ai/gemma-http.provider";
import { LocalRuleAIProvider } from "../ai/local-rule.provider";
import type {
  AIActionEnvelope,
  AIChatMessageRecord,
  AIConversationTurn,
  AIExecutionResult,
} from "../types/domain";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text?: string;
  tone?: "normal" | "success" | "error" | "warning";
  action?: AIActionEnvelope;
  actionDecision?: "confirmed" | "cancelled";
  result?: AIExecutionResult;
  quickReplies?: string[];
  source?: "gemma" | "local-rules";
  model?: string;
}

const ACTIVE_CHAT_STORAGE_KEY = "negocio-ia-active-chat";

const SPEECH_RECOGNITION_LANG = "es-PE";

function createSpeechRecognition(): SpeechRecognition | null {
  const Recognition =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;

  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = SPEECH_RECOGNITION_LANG;
  recognition.interimResults = true;
  recognition.continuous = false;

  return recognition;
}

function transcriptFrom(event: SpeechRecognitionEvent): string {
  let transcript = "";

  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const alternative = result?.[0];
    if (alternative) transcript += alternative.transcript;
  }

  return transcript.trim();
}

function speechErrorMessage(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "No se pudo usar el micrófono: falta el permiso del navegador.";
  }

  if (error === "no-speech") {
    return "No escuché nada. Intenta grabar otra vez.";
  }

  if (error === "audio-capture") {
    return "No se detectó un micrófono disponible.";
  }

  return "No se pudo completar el dictado por voz. Intenta otra vez.";
}

const examples = [
  "Vendí 3 gaseosas a 4 soles y me pagaron por Yape",
  "Gasté 60 soles en internet y pagué en efectivo",
  "Fié 2 cuadernos a María por 16 soles",
  "María pagó 6 soles de su deuda por Yape",
  "¿Quiénes nos deben?",
  "¿Cómo nos fue hoy?",
  "Siento que vendo pero no gano, ¿qué puede estar pasando?",
  "¿Qué debería priorizar mañana?",
  "Dame una proyección de este mes",
  "¿Qué me recomiendas mejorar?",
  "Dame el reporte de los últimos 7 días",
];


function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function deserializeMessage(record: AIChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    role: record.role,
    text: record.text ?? undefined,
    tone: record.tone,
    action: parseJson<AIActionEnvelope>(record.actionJson),
    actionDecision: record.actionDecision ?? undefined,
    result: parseJson<AIExecutionResult>(record.resultJson),
    quickReplies: parseJson<string[]>(record.quickRepliesJson),
    source: record.source ?? undefined,
    model: record.model ?? undefined,
  };
}


function clarificationChanged(
  previous: AIActionEnvelope,
  next: AIActionEnvelope,
): boolean {
  return (
    previous.action !== next.action ||
    previous.missingFields.join("|") !==
      next.missingFields.join("|") ||
    JSON.stringify(previous.data) !== JSON.stringify(next.data)
  );
}

function formatChatDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function AssistantPage() {
  const provider = useMemo(
    () =>
      new GemmaHttpProvider(
        "/api/ai/interpret",
        new LocalRuleAIProvider(),
      ),
    [],
  );

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const products = useLiveQuery(
    () => db.products.filter((product) => product.active).toArray(),
    [],
    [],
  );
  const customers = useLiveQuery(
    () => db.customers.filter((customer) => customer.active).toArray(),
    [],
    [],
  );
  const debts = useLiveQuery(() => db.debts.toArray(), [], []);
  const recentOperations = useLiveQuery(
    () => getRecentBusinessOperations(15),
    [],
    [],
  );
  const businessSnapshot = useLiveQuery(
    () => getBusinessConversationSnapshot(),
    [],
    EMPTY_BUSINESS_SNAPSHOT,
  );
  const chatSessions = useLiveQuery(
    () => db.aiChatSessions.orderBy("updatedAt").reverse().toArray(),
    [],
    [],
  );

  const [activeSessionId, setActiveSessionId] =
    useState<string | null>(null);
  const storedMessages = useLiveQuery(
    async () => {
      if (!activeSessionId) return [];
      return db.aiChatMessages
        .where("sessionId")
        .equals(activeSessionId)
        .sortBy("createdAt");
    },
    [activeSessionId],
    [],
  );

  const messages = useMemo(
    () => (storedMessages ?? []).map(deserializeMessage),
    [storedMessages],
  );
  const activeSession = useMemo(
    () =>
      (chatSessions ?? []).find(
        (session) => session.id === activeSessionId,
      ) ?? null,
    [chatSessions, activeSessionId],
  );

  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] =
    useState<AIActionEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [gemmaStatus, setGemmaStatus] =
    useState<GemmaConnectionStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const filteredSessions = useMemo(() => {
    const query = chatSearch.toLowerCase().trim();
    if (!query) return chatSessions ?? [];

    return (chatSessions ?? []).filter((session) =>
      `${session.title} ${session.preview}`
        .toLowerCase()
        .includes(query),
    );
  }, [chatSessions, chatSearch]);

  useEffect(() => {
    let cancelled = false;

    async function initializeChat() {
      await invalidateStalePendingActions();

      const preferredId = window.localStorage.getItem(
        ACTIVE_CHAT_STORAGE_KEY,
      );
      const session = await ensureChatSession(preferredId);

      if (!cancelled) {
        setActiveSessionId(session.id);
        setChatReady(true);
      }
    }

    void initializeChat();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;

    window.localStorage.setItem(
      ACTIVE_CHAT_STORAGE_KEY,
      activeSessionId,
    );
    setInput("");

    const restored =
      activeSession?.pendingActionVersion ===
        AI_ACTION_SCHEMA_VERSION
        ? parseJson<AIActionEnvelope>(
            activeSession.pendingActionJson,
          )
        : undefined;

    setPendingAction(restored ?? null);
  }, [activeSessionId, activeSession?.pendingActionJson]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      const status = await getGemmaConnectionStatus();
      if (!cancelled) setGemmaStatus(status);
    }

    void refreshStatus();
    const interval = window.setInterval(refreshStatus, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  function isOperationalUserText(value: string): boolean {
    const normalized = value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return (
      /\b(vendi|vendimos|vendio|fie|fiamos|fio|compre|compramos|gaste|gastamos|pague|pagamos|me pagaron|abona|abono)\b/.test(
        normalized,
      ) ||
      /\b(registra|registrar|anota|anotar)\b.*\b(venta|compra|gasto|fiado|abono)\b/.test(
        normalized,
      )
    );
  }

  function buildOperationalHistory(): string[] {
    return messages
      .filter(
        (message) =>
          message.role === "user" &&
          Boolean(message.text) &&
          isOperationalUserText(message.text!),
      )
      .map((message) => message.text!)
      .slice(-8);
  }

  function buildConversationHistory(): AIConversationTurn[] {
    const turns: AIConversationTurn[] = [];

    for (const message of messages) {
      if (message.role === "user" && message.text) {
        if (isOperationalUserText(message.text)) {
          continue;
        }

        turns.push({
          role: "user",
          content: message.text,
        });
        continue;
      }

      if (message.role === "assistant") {
        // Las tarjetas operativas no se envían como memoria conversacional.
        // Las operaciones reales ya están disponibles en recentOperations.
        if (message.action) continue;

        const parts: string[] = [];

        if (
          message.text &&
          !/\b(registrare|registraré|prepar[eé] una|voy a registrar)\b/i.test(
            message.text,
          )
        ) {
          parts.push(message.text);
        }

        if (message.result) {
          parts.push(
            `${message.result.title}: ${message.result.message}`,
          );

          if (message.result.details?.length) {
            parts.push(
              message.result.details
                .map(
                  (detail) =>
                    `${detail.label}: ${detail.value}`,
                )
                .join(" · "),
            );
          }
        }

        if (parts.length) {
          turns.push({
            role: "assistant",
            content: parts.join("\n"),
          });
        }
      }
    }

    return turns.slice(-16);
  }

  async function persistPendingAction(
    action: AIActionEnvelope | null,
  ) {
    setPendingAction(action);

    if (activeSessionId) {
      await setChatSessionPendingAction(activeSessionId, action);
    }
  }

  async function appendMessage(
    message: Omit<ChatMessage, "id">,
  ): Promise<string> {
    if (!activeSessionId) {
      throw new Error("La conversación todavía se está cargando.");
    }

    const record = await appendChatMessage(activeSessionId, {
      role: message.role,
      text: message.text,
      tone: message.tone,
      action: message.action,
      actionDecision: message.actionDecision,
      result: message.result,
      quickReplies: message.quickReplies,
      source: message.source,
      model: message.model,
    });

    return record.id;
  }

  async function markActionDecision(
    actionId: string,
    decision: "confirmed" | "cancelled",
  ) {
    const targetMessage = messages.find(
      (message) => message.action?.id === actionId,
    );

    if (targetMessage) {
      await updateChatMessage(targetMessage.id, {
        actionDecision: decision,
      });
    }
  }

  async function handleCompletedInterpretation(
    action: AIActionEnvelope,
  ) {
    await saveAIAction(action);

    if (action.action === "unsupported") {
      await appendMessage({
        role: "assistant",
        text: action.userMessage,
        tone: "error",
      });
      await persistPendingAction(null);
      return;
    }

    if (action.missingFields.length) {
      await persistPendingAction(action);
      await appendMessage({
        role: "assistant",
        text:
          clarificationQuestion(action) ??
          "Necesito un dato adicional para continuar.",
      });
      return;
    }

    if (action.requiresConfirmation) {
      await persistPendingAction(action);
      await appendMessage({
        role: "assistant",
        text: action.userMessage,
        action,
      });
      return;
    }

    await persistPendingAction(null);
    const result = await executeAIAction(action);

    if (action.action === "conversation") {
      await appendMessage({
        role: "assistant",
        text: result.message,
        quickReplies: result.quickReplies,
        source: action.source,
        model: action.model,
        tone: result.tone ?? "normal",
      });
      return;
    }

    await appendMessage({
      role: "assistant",
      result,
      tone: result.tone ?? "normal",
    });
  }

  async function handleClarifiedAction(
    clarified: AIActionEnvelope,
    previousAction: AIActionEnvelope,
  ) {
    const sameMissing =
      clarified.missingFields[0] === previousAction.missingFields[0];

    await saveAIAction(clarified);
    await persistPendingAction(clarified);

    if (
      sameMissing &&
      clarified.missingFields.length >=
        previousAction.missingFields.length
    ) {
      await appendMessage({
        role: "assistant",
        text:
          clarificationQuestion(clarified) ??
          "Todavía necesito ese dato para continuar.",
        tone: "warning",
      });
    } else if (clarified.missingFields.length) {
      await appendMessage({
        role: "assistant",
        text:
          clarificationQuestion(clarified) ??
          "Necesito otro dato para continuar.",
      });
    } else if (clarified.requiresConfirmation) {
      await appendMessage({
        role: "assistant",
        text:
          "Ya actualicé la operación. Revisa el resumen y confirma.",
        action: clarified,
      });
    } else {
      await handleCompletedInterpretation(clarified);
    }
  }

  async function sendText(textValue?: string) {
    const text = (textValue ?? input).trim();
    if (!text || busy || !chatReady || !activeSessionId) return;

    setInput("");
    await appendMessage({ role: "user", text });
    setBusy(true);

    try {
      if (pendingAction?.missingFields.length) {
        const deterministic = applyClarification(
          pendingAction,
          text,
          products ?? [],
          customers ?? [],
        );

        if (clarificationChanged(pendingAction, deterministic)) {
          deterministic.source = pendingAction.source;
          deterministic.model = pendingAction.model;

          await handleClarifiedAction(
            deterministic,
            pendingAction,
          );
          return;
        }

        const context = {
          products: products ?? [],
          customers: customers ?? [],
          debts: debts ?? [],
          recentOperations: recentOperations ?? [],
          businessSnapshot:
            businessSnapshot ?? EMPTY_BUSINESS_SNAPSHOT,
          conversationHistory: buildConversationHistory(),
          operationalHistory: buildOperationalHistory(),
        };

        try {
          const outcome = await provider.clarify(
            pendingAction,
            text,
            context,
          );

          if (outcome.kind === "assistant_message") {
            await appendMessage({
              role: "assistant",
              text: outcome.message,
            });
            return;
          }

          if (outcome.kind === "cancel") {
            await cancelAIAction(pendingAction);
            await persistPendingAction(null);
            await appendMessage({
              role: "assistant",
              text: outcome.message,
            });
            return;
          }

          await handleClarifiedAction(
            outcome.action,
            pendingAction,
          );
        } catch {
          const clarified = applyClarification(
            pendingAction,
            text,
            products ?? [],
            customers ?? [],
          );

          clarified.source = "local-rules";
          clarified.warnings = [
            "Gemma no pudo procesar esta respuesta; se utilizó el aclarador local de respaldo.",
            ...clarified.warnings,
          ];

          await handleClarifiedAction(
            clarified,
            pendingAction,
          );
        }

        return;
      }

      if (pendingAction && !pendingAction.missingFields.length) {
        await appendMessage({
          role: "assistant",
          text:
            "Primero confirma o corrige la operación pendiente antes de iniciar otra.",
          tone: "warning",
        });
        return;
      }

      const action = await provider.interpret(text, {
        products: products ?? [],
        customers: customers ?? [],
        debts: debts ?? [],
        recentOperations: recentOperations ?? [],
        businessSnapshot:
          businessSnapshot ?? EMPTY_BUSINESS_SNAPSHOT,
        conversationHistory: buildConversationHistory(),
        operationalHistory: buildOperationalHistory(),
      });

      await handleCompletedInterpretation(action);
    } catch (error) {
      await appendMessage({
        role: "assistant",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo procesar la instrucción.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition =
      recognitionRef.current ?? createSpeechRecognition();

    if (!recognition) {
      setVoiceError(
        "Este navegador no permite dictado por voz. Usa Chrome o Edge, o escribe tu mensaje.",
      );
      return;
    }

    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      setInput(transcriptFrom(event));
    };

    recognition.onerror = (event) => {
      setRecording(false);
      setVoiceError(speechErrorMessage(event.error));
    };

    recognition.onend = () => {
      setRecording(false);
    };

    try {
      recognition.start();
      setVoiceError(null);
      setRecording(true);
    } catch {
      setRecording(false);
      setVoiceError(
        "No se pudo iniciar el dictado por voz. Intenta otra vez.",
      );
    }
  }

  async function confirmAction(action: AIActionEnvelope) {
    if (busy || pendingAction?.id !== action.id) return;
    setBusy(true);

    try {
      const result = await executeAIAction(action);
      await markActionDecision(action.id, "confirmed");
      await appendMessage({
        role: "assistant",
        result,
        tone: "success",
      });
      await persistPendingAction(null);
    } catch (error) {
      await appendMessage({
        role: "assistant",
        text:
          error instanceof Error
            ? `No pude ejecutar la acción: ${error.message}`
            : "No pude ejecutar la acción.",
        tone: "error",
      });
      await persistPendingAction(null);
    } finally {
      setBusy(false);
    }
  }

  async function correctAction(action: AIActionEnvelope) {
    if (busy || pendingAction?.id !== action.id) return;

    await cancelAIAction(action);
    await markActionDecision(action.id, "cancelled");
    await persistPendingAction(null);
    setInput(action.originalText);

    await appendMessage({
      role: "assistant",
      text:
        "La operación no fue guardada. Edita la frase en el cuadro inferior y envíala nuevamente.",
    });
  }

  async function startNewConversation() {
    if (busy) return;
    const session = await createChatSession();
    setActiveSessionId(session.id);
    setChatSearch("");
    setShowHistory(false);
  }

  function selectConversation(sessionId: string) {
    if (busy || sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setShowHistory(false);
  }

  async function renameConversation(
    sessionId: string,
    currentTitle: string,
  ) {
    const nextTitle = window.prompt(
      "Nombre de la conversación:",
      currentTitle,
    );

    if (nextTitle?.trim()) {
      await renameChatSession(sessionId, nextTitle);
    }
  }

  async function removeConversation(sessionId: string) {
    const session = (chatSessions ?? []).find(
      (item) => item.id === sessionId,
    );

    const accepted = window.confirm(
      `¿Eliminar la conversación “${session?.title ?? "seleccionada"}”? Esto elimina únicamente el chat, no las operaciones del negocio.`,
    );

    if (!accepted) return;

    await deleteChatSession(sessionId);

    if (sessionId !== activeSessionId) return;

    const nextSession = (chatSessions ?? []).find(
      (item) => item.id !== sessionId,
    );

    if (nextSession) {
      setActiveSessionId(nextSession.id);
      return;
    }

    const created = await createChatSession();
    setActiveSessionId(created.id);
  }


  return (
    <section className="mobile-ai-screen">
      <header className="mobile-ai-toolbar">
        <div className="mobile-ai-identity">
          <span className="mobile-ai-orb">
            <Sparkles size={23} />
          </span>
          <div>
            <span>ASISTENTE DEL NEGOCIO</span>
            <h1>
              {activeSession?.title ?? "Cargando conversación…"}
            </h1>
            <small
              className={
                gemmaStatus?.connected &&
                gemmaStatus.modelInstalled &&
                gemmaStatus.versionCompatible
                  ? "connected"
                  : "offline"
              }
            >
              <i />
              {gemmaStatus?.connected &&
              gemmaStatus.modelInstalled &&
              gemmaStatus.versionCompatible
                ? `Gemma conectado · v${gemmaStatus.appVersion}`
                : "Modo local de respaldo"}
            </small>
          </div>
        </div>

        <div className="mobile-ai-toolbar-actions">
          <button
            onClick={() => setShowHistory(true)}
            title="Historial de conversaciones"
          >
            <History size={20} />
          </button>
          <button
            className="primary"
            onClick={() => void startNewConversation()}
            disabled={busy || !chatReady}
            title="Nueva conversación"
          >
            <Plus size={21} />
          </button>
        </div>
      </header>

      {gemmaStatus &&
      (
        !gemmaStatus.connected ||
        !gemmaStatus.modelInstalled ||
        !gemmaStatus.versionCompatible
      ) ? (
        <div className="mobile-ai-notice">
          <Sparkles size={19} />
          <div>
            <strong>
              {!gemmaStatus.versionCompatible
                ? "Servidor de otra versión"
                : "Gemma no está disponible"}
            </strong>
            <p>
              {gemmaStatus.error ??
                "La aplicación utilizará el respaldo local hasta recuperar la conexión."}
            </p>
          </div>
        </div>
      ) : null}

      {showHistory ? (
        <div className="mobile-chat-history-overlay">
          <button
            className="mobile-history-backdrop"
            aria-label="Cerrar historial"
            onClick={() => setShowHistory(false)}
          />
          <section className="mobile-chat-history-sheet">
            <header>
              <div>
                <span>CONVERSACIONES</span>
                <h2>Historial</h2>
              </div>
              <button onClick={() => setShowHistory(false)}>
                <X size={20} />
              </button>
            </header>

            <button
              className="mobile-new-chat-button"
              onClick={() => void startNewConversation()}
              disabled={busy}
            >
              <Plus size={19} />
              Nueva conversación
            </button>

            <div className="mobile-history-search">
              <Search size={17} />
              <input
                value={chatSearch}
                onChange={(event) =>
                  setChatSearch(event.target.value)
                }
                placeholder="Buscar conversación"
              />
            </div>

            <div className="mobile-history-list">
              {filteredSessions.length ? (
                filteredSessions.map((session) => (
                  <article
                    className={
                      session.id === activeSessionId
                        ? "active"
                        : ""
                    }
                    key={session.id}
                  >
                    <button
                      className="mobile-history-main"
                      onClick={() =>
                        selectConversation(session.id)
                      }
                      disabled={busy}
                    >
                      <strong>{session.title}</strong>
                      <span>{session.preview}</span>
                      <small>
                        {formatChatDate(session.updatedAt)}
                        {session.pendingActionJson &&
                        session.pendingActionVersion ===
                          AI_ACTION_SCHEMA_VERSION
                          ? " · operación pendiente"
                          : ""}
                      </small>
                    </button>
                    <div>
                      <button
                        title="Renombrar"
                        onClick={() =>
                          void renameConversation(
                            session.id,
                            session.title,
                          )
                        }
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        title="Eliminar"
                        onClick={() =>
                          void removeConversation(session.id)
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="mobile-history-empty">
                  No encontramos conversaciones.
                </p>
              )}
            </div>

            <p className="mobile-history-footnote">
              Borrar un chat no elimina ventas, compras, gastos
              ni fiados.
            </p>
          </section>
        </div>
      ) : null}

      <article className="mobile-ai-chat">
        <div className="mobile-ai-messages">
          {!chatReady ? (
            <div className="chat-loading-state">
              Cargando historial…
            </div>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`assistant-message ${message.role} ${
                message.tone ?? "normal"
              } ${message.action ? "has-action-card" : ""} ${
                message.result ? "has-result-card" : ""
              }`}
            >
              {message.text ? <p>{message.text}</p> : null}

              {message.role === "assistant" && message.source ? (
                <small
                  className={`conversation-source ${
                    message.source === "gemma"
                      ? "gemma"
                      : "local"
                  }`}
                >
                  {message.source === "gemma"
                    ? `Gemma · ${message.model ?? "modelo local"}`
                    : "Respaldo local"}
                </small>
              ) : null}

              {message.quickReplies?.length ? (
                <div className="conversation-quick-replies">
                  {message.quickReplies.map((reply) => (
                    <button
                      key={reply}
                      onClick={() => void sendText(reply)}
                      disabled={busy || Boolean(pendingAction)}
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              ) : null}

              {message.action ? (
                <section
                  className={`inline-action-card ${
                    message.actionDecision ?? ""
                  }`}
                >
                  <div className="inline-card-heading">
                    <div>
                      <span>REVISAR ANTES DE GUARDAR</span>
                      <h3>{actionTitle(message.action)}</h3>
                      <small
                        className={`action-source-badge ${
                          message.action.source === "gemma"
                            ? "gemma"
                            : "local"
                        }`}
                      >
                        {message.action.source === "gemma"
                          ? `Interpretado por ${
                              message.action.model ?? "Gemma"
                            }`
                          : "Interpretado por respaldo local"}
                      </small>
                    </div>
                    <b>
                      {Math.round(
                        message.action.confidence * 100,
                      )}
                      %
                    </b>
                  </div>

                  <div className="inline-preview-grid">
                    {actionPreviewRows(message.action).map(
                      (row) => (
                        <div
                          className="inline-preview-row"
                          key={row.label}
                        >
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ),
                    )}
                  </div>

                  {message.action.warnings.length ? (
                    <div className="ai-warning-box">
                      {message.action.warnings.map(
                        (warning) => (
                          <p key={warning}>⚠ {warning}</p>
                        ),
                      )}
                    </div>
                  ) : null}

                  {message.actionDecision ||
                  pendingAction?.id !== message.action.id ? (
                    <div className="inline-decision-state">
                      {message.actionDecision === "confirmed"
                        ? "✓ Operación confirmada"
                        : message.actionDecision === "cancelled"
                          ? "Operación corregida o cancelada"
                          : "Operación antigua no ejecutada"}
                    </div>
                  ) : (
                    <div className="inline-card-actions">
                      <button
                        className="secondary-button"
                        onClick={() =>
                          void correctAction(message.action!)
                        }
                        disabled={busy}
                      >
                        Corregir
                      </button>
                      <button
                        className="primary-button"
                        onClick={() =>
                          void confirmAction(message.action!)
                        }
                        disabled={busy}
                      >
                        {busy ? "Guardando…" : "Confirmar"}
                      </button>
                    </div>
                  )}
                </section>
              ) : null}

              {message.result ? (
                <section className="inline-result-card">
                  <span className="result-kicker">
                    {message.result.kind === "analysis"
                      ? "ANÁLISIS"
                      : "RESULTADO"}
                  </span>
                  <h3>{message.result.title}</h3>
                  <p>{message.result.message}</p>

                  {message.result.details?.length ? (
                    <div className="inline-result-details">
                      {message.result.details.map((detail) => (
                        <div key={detail.label}>
                          <span>{detail.label}</span>
                          <strong>{detail.value}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {message.result.suggestions?.length ? (
                    <div className="inline-suggestions">
                      {message.result.suggestions.map(
                        (suggestion) => (
                          <div key={suggestion}>
                            ✦ {suggestion}
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}

                  {message.result.quickReplies?.length ? (
                    <div className="result-quick-replies">
                      {message.result.quickReplies.map(
                        (reply) => (
                          <button
                            key={reply}
                            onClick={() => void sendText(reply)}
                            disabled={
                              busy || Boolean(pendingAction)
                            }
                          >
                            {reply}
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          ))}

          {busy ? (
            <div className="mobile-ai-thinking">
              <i />
              <i />
              <i />
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>

        {!pendingAction && chatReady ? (
          <div className="mobile-ai-suggestions">
            {examples.slice(0, 6).map((example) => (
              <button
                key={example}
                onClick={() => void sendText(example)}
                disabled={busy}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {voiceError ? (
          <p className="mobile-ai-voice-error" role="alert">
            {voiceError}
          </p>
        ) : null}

        <div className="mobile-ai-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();
                void sendText();
              }
            }}
            placeholder={
              !chatReady
                ? "Cargando historial…"
                : pendingAction?.missingFields.length
                  ? clarificationQuestion(pendingAction) ??
                    "Escribe el dato…"
                  : pendingAction
                    ? "Confirma o corrige la operación"
                    : "Escribe una operación o pregunta…"
            }
            rows={2}
            disabled={
              !chatReady ||
              busy ||
              Boolean(
                pendingAction &&
                  !pendingAction.missingFields.length,
              )
            }
          />
          <button
            onClick={() => void sendText()}
            disabled={
              !chatReady ||
              busy ||
              !input.trim() ||
              Boolean(
                pendingAction &&
                  !pendingAction.missingFields.length,
              )
            }
            aria-label="Enviar"
          >
            <SendHorizontal size={21} />
          </button>
          <button
            type="button"
            className={`mobile-ai-mic${recording ? " recording" : ""}`}
            onClick={toggleRecording}
            disabled={
              !chatReady ||
              busy ||
              Boolean(
                pendingAction &&
                  !pendingAction.missingFields.length,
              )
            }
            aria-pressed={recording}
            aria-label={
              recording
                ? "Detener dictado por voz"
                : "Dictar por voz"
            }
            title={
              recording
                ? "Detener dictado por voz"
                : "Dictar por voz"
            }
          >
            {recording ? <MicOff size={21} /> : <Mic size={21} />}
          </button>
        </div>
      </article>
    </section>
  );
}
