import http from "node:http";
import {
  gemmaClarificationSchema,
  gemmaInterpretationSchema,
} from "./ai-schema.mjs";
import { normalizeGemmaAction } from "./normalize-action.mjs";
import {
  buildBusinessIdeaFallback,
  containsInternalDataContamination,
  isBusinessIdeaRequest,
} from "./conversation-routing.mjs";
import {
  buildClarificationPrompt,
  buildUserPrompt,
  ADVISORY_FOLLOWUP_SYSTEM_PROMPT,
  BUSINESS_CONVERSATION_SYSTEM_PROMPT,
  BUSINESS_IDEA_SYSTEM_PROMPT,
  CLARIFICATION_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "./prompt.mjs";

const APP_VERSION = "2.5.2";
const PORT = Number(process.env.AI_SERVER_PORT ?? 8787);
const OLLAMA_HOST = (
  process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"
).replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma3:4b";
const MAX_BODY_BYTES = 2_000_000;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("La solicitud es demasiado grande.");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 90_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function matchesConfiguredModel(name) {
  if (typeof name !== "string") return false;
  return (
    name === OLLAMA_MODEL ||
    name === `${OLLAMA_MODEL}:latest` ||
    (name.split(":")[0] === OLLAMA_MODEL.split(":")[0] &&
      OLLAMA_MODEL.endsWith(":latest"))
  );
}

async function getOllamaStatus() {
  try {
    const response = await fetchWithTimeout(
      `${OLLAMA_HOST}/api/tags`,
      {},
      5_000,
    );

    if (!response.ok) {
      throw new Error(`Ollama respondió ${response.status}.`);
    }

    const body = await response.json();
    const names = Array.isArray(body.models)
      ? body.models
          .map((model) => model.name ?? model.model)
          .filter(Boolean)
      : [];

    return {
      connected: true,
      modelInstalled: names.some(matchesConfiguredModel),
      installedModels: names,
    };
  } catch (error) {
    return {
      connected: false,
      modelInstalled: false,
      installedModels: [],
      error:
        error instanceof Error
          ? error.message
          : "Ollama no disponible.",
    };
  }
}

function validateContext(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Solicitud inválida.");
  }

  return {
    products: Array.isArray(body.products)
      ? body.products.slice(0, 500)
      : [],
    customers: Array.isArray(body.customers)
      ? body.customers.slice(0, 500)
      : [],
    pendingDebts: Array.isArray(body.pendingDebts)
      ? body.pendingDebts.slice(0, 1000)
      : [],
    recentOperations: Array.isArray(body.recentOperations)
      ? body.recentOperations.slice(0, 50)
      : [],
    businessSnapshot:
      body.businessSnapshot &&
      typeof body.businessSnapshot === "object"
        ? body.businessSnapshot
        : {},
    conversationHistory: Array.isArray(body.conversationHistory)
      ? body.conversationHistory.slice(-16)
      : [],
    operationalHistory: Array.isArray(body.operationalHistory)
      ? body.operationalHistory
          .filter((item) => typeof item === "string")
          .slice(-8)
      : [],
  };
}

function validateInterpretRequest(body) {
  const context = validateContext(body);

  if (typeof body.text !== "string" || !body.text.trim()) {
    throw new Error("Falta el texto del usuario.");
  }

  return {
    text: body.text.trim(),
    ...context,
  };
}

function validateClarificationRequest(body) {
  const context = validateContext(body);

  if (typeof body.answer !== "string" || !body.answer.trim()) {
    throw new Error("Falta la respuesta del usuario.");
  }

  if (
    !body.pendingAction ||
    typeof body.pendingAction !== "object" ||
    typeof body.pendingAction.originalText !== "string"
  ) {
    throw new Error("Falta la acción pendiente.");
  }

  return {
    answer: body.answer.trim(),
    pendingAction: body.pendingAction,
    ...context,
  };
}

async function callGemma({
  systemPrompt,
  userPrompt,
  format,
  timeoutMs = 120_000,
}) {
  const response = await fetchWithTimeout(
    `${OLLAMA_HOST}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format,
        keep_alive: "10m",
        options: {
          temperature: 0,
          num_ctx: 8192,
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Ollama respondió ${response.status}: ${errorText.slice(0, 300)}`,
    );
  }

  const body = await response.json();
  const content = body?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Gemma respondió sin contenido utilizable.");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Gemma no devolvió JSON válido.");
  }
}


function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitOperationalIntent(value) {
  const text = normalizeText(value);

  return (
    /\b(vendi|vendimos|vendio|fie|fiamos|fio|compre|compramos|gaste|gastamos|pague|pagamos|me pagaron|abona|abono)\b/.test(
      text,
    ) ||
    /\b(registra|registrar|anota|anotar)\b.*\b(venta|compra|gasto|fiado|abono)\b/.test(
      text,
    ) ||
    /\b(anula|anular|elimina|eliminar|deshaz|cancelar)\b.*\b(venta|compra|gasto|operacion|movimiento)\b/.test(
      text,
    )
  );
}

function lastConversationTurn(context, role) {
  for (
    let index = context.conversationHistory.length - 1;
    index >= 0;
    index -= 1
  ) {
    const turn = context.conversationHistory[index];
    if (
      turn?.role === role &&
      typeof turn.content === "string" &&
      turn.content.trim()
    ) {
      return turn.content.trim();
    }
  }

  return "";
}

function isAdvisoryFollowUp(context) {
  if (hasExplicitOperationalIntent(context.text)) {
    return false;
  }

  const lastAssistant = normalizeText(
    lastConversationTurn(context, "assistant"),
  );

  if (!lastAssistant || !lastAssistant.includes("?")) {
    return false;
  }

  const asksForPreference =
    /\b(que tipo|cuales|que productos|que categoria|te gustaria|tienes en mente|prefieres|que opcion|que clase|que presupuesto|a quienes|para que clientes)\b/.test(
      lastAssistant,
    );

  const advisoryTopic =
    /\b(recomiend|producto|vender|negocio|barberia|cabello|inventario|clientes|estrategia|mejorar|priorizar|comprar)\b/.test(
      lastAssistant,
    );

  return asksForPreference && advisoryTopic;
}

function forceConversationPayload(parsed) {
  parsed.action = "conversation";
  parsed.productId = null;
  parsed.productName = null;
  parsed.createProductIfMissing = false;
  parsed.quantity = null;
  parsed.unitPrice = null;
  parsed.paymentMethod = null;
  parsed.customerId = null;
  parsed.customerName = null;
  parsed.amount = null;
  parsed.operationId = null;
  parsed.operationType = null;
  parsed.warnings = [];
  return parsed;
}

function containsFalseMutationClaim(value) {
  return /\b(registrando|registre|registré|he registrado|ya registre|ya registré|guardando|guarde|guardé|he guardado|actualizando|actualice|actualicé|procedo a registrar|voy a registrar)\b/i.test(
    String(value ?? ""),
  );
}

async function interpretWithGemma(context) {
  const userPrompt = buildUserPrompt(context);
  const businessIdeaRequest = isBusinessIdeaRequest(context);
  const advisoryFollowUp =
    !businessIdeaRequest && isAdvisoryFollowUp(context);

  const selectedPrompt = businessIdeaRequest
    ? BUSINESS_IDEA_SYSTEM_PROMPT
    : advisoryFollowUp
      ? ADVISORY_FOLLOWUP_SYSTEM_PROMPT
      : SYSTEM_PROMPT;

  const parsed = await callGemma({
    systemPrompt: selectedPrompt,
    userPrompt,
    format: gemmaInterpretationSchema,
  });

  if (businessIdeaRequest || advisoryFollowUp) {
    forceConversationPayload(parsed);

    const unsafeIdeaResponse =
      businessIdeaRequest &&
      (
        !parsed.responseText ||
        containsInternalDataContamination(parsed.responseText)
      );

    if (
      unsafeIdeaResponse ||
      containsFalseMutationClaim(parsed.responseText)
    ) {
      const fallback = buildBusinessIdeaFallback(context);
      parsed.responseText = fallback.responseText;
      parsed.suggestedPrompts = fallback.suggestedPrompts;
    }
  }

  let action = normalizeGemmaAction(
    parsed,
    context,
    context.text,
  );

  const needsSecondConversation =
    action.action === "unsupported" ||
    (
      action.action === "conversation" &&
      containsFalseMutationClaim(action.data.responseText)
    ) ||
    (
      businessIdeaRequest &&
      (
        action.action !== "conversation" ||
        containsInternalDataContamination(
          action.data.responseText,
        )
      )
    );

  if (needsSecondConversation) {
    const conversational = await callGemma({
      systemPrompt: businessIdeaRequest
        ? BUSINESS_IDEA_SYSTEM_PROMPT
        : advisoryFollowUp
          ? ADVISORY_FOLLOWUP_SYSTEM_PROMPT
          : BUSINESS_CONVERSATION_SYSTEM_PROMPT,
      userPrompt,
      format: gemmaInterpretationSchema,
    });

    if (businessIdeaRequest || advisoryFollowUp) {
      forceConversationPayload(conversational);
    }

    if (
      businessIdeaRequest &&
      (
        !conversational.responseText ||
        containsInternalDataContamination(
          conversational.responseText,
        )
      )
    ) {
      const fallback = buildBusinessIdeaFallback(context);
      conversational.responseText = fallback.responseText;
      conversational.suggestedPrompts =
        fallback.suggestedPrompts;
    }

    action = normalizeGemmaAction(
      conversational,
      context,
      context.text,
    );
  }

  if (
    businessIdeaRequest &&
    (
      action.action !== "conversation" ||
      containsInternalDataContamination(
        action.data.responseText,
      )
    )
  ) {
    const fallback = buildBusinessIdeaFallback(context);
    action = normalizeGemmaAction(
      {
        ...parsed,
        action: "conversation",
        responseText: fallback.responseText,
        suggestedPrompts: fallback.suggestedPrompts,
        warnings: [],
      },
      context,
      context.text,
    );
  }

  return {
    ...action,
    source: "gemma",
    model: OLLAMA_MODEL,
  };
}

async function clarifyWithGemma(context) {
  const parsed = await callGemma({
    systemPrompt: CLARIFICATION_SYSTEM_PROMPT,
    userPrompt: buildClarificationPrompt(context),
    format: gemmaClarificationSchema,
  });

  if (parsed.kind === "cancel") {
    return {
      kind: "cancel",
      message:
        typeof parsed.assistantMessage === "string" &&
        parsed.assistantMessage.trim()
          ? parsed.assistantMessage.trim()
          : "La operación fue cancelada y no se guardará.",
    };
  }

  if (parsed.kind === "explain") {
    return {
      kind: "assistant_message",
      message:
        typeof parsed.assistantMessage === "string" &&
        parsed.assistantMessage.trim()
          ? parsed.assistantMessage.trim()
          : "Necesito el dato solicitado para poder preparar la operación.",
    };
  }

  const normalizedAction = normalizeGemmaAction(
    parsed.action,
    context,
    context.pendingAction.originalText,
  );

  const allowedCreditCorrection =
    context.pendingAction.action === "register_sale" &&
    normalizedAction.action === "register_credit_sale";

  if (
    context.pendingAction.requiresConfirmation &&
    normalizedAction.action !== context.pendingAction.action &&
    !allowedCreditCorrection
  ) {
    throw new Error(
      "Gemma intentó convertir una operación pendiente en otro tipo de respuesta. Se usará el aclarador seguro.",
    );
  }

  if (
    context.pendingAction.requiresConfirmation &&
    !normalizedAction.requiresConfirmation
  ) {
    throw new Error(
      "Una aclaración operativa no puede convertirse en conversación.",
    );
  }

  const action = {
    ...normalizedAction,
    id: context.pendingAction.id,
    source: "gemma",
    model: OLLAMA_MODEL,
  };

  return {
    kind: "updated_action",
    message:
      typeof parsed.assistantMessage === "string" &&
      parsed.assistantMessage.trim()
        ? parsed.assistantMessage.trim()
        : "Actualicé la operación con tu respuesta.",
    action,
  };
}

async function ensureGemmaAvailable(response) {
  const status = await getOllamaStatus();

  if (!status.connected) {
    sendJson(response, 503, {
      code: "OLLAMA_UNAVAILABLE",
      message: "Ollama no está iniciado.",
      model: OLLAMA_MODEL,
    });
    return false;
  }

  if (!status.modelInstalled) {
    sendJson(response, 503, {
      code: "MODEL_NOT_INSTALLED",
      message: `El modelo ${OLLAMA_MODEL} todavía no está instalado.`,
      model: OLLAMA_MODEL,
    });
    return false;
  }

  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (request.method === "OPTIONS") {
      return sendJson(response, 204, {});
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/health"
    ) {
      return sendJson(response, 200, {
        ok: true,
        service: "negocio-ia-gemma",
        appVersion: APP_VERSION,
        processId: process.pid,
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/ai/status"
    ) {
      const status = await getOllamaStatus();
      return sendJson(response, 200, {
        provider: "ollama",
        model: OLLAMA_MODEL,
        appVersion: APP_VERSION,
        processId: process.pid,
        ...status,
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/ai/interpret"
    ) {
      if (!(await ensureGemmaAvailable(response))) return;

      const context = validateInterpretRequest(
        await readJson(request),
      );
      const action = await interpretWithGemma(context);

      console.log(
        `[Gemma] ${JSON.stringify({
          action: action.action,
          missingFields: action.missingFields,
          product: action.data.productName,
        })}`,
      );

      return sendJson(response, 200, action);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/ai/clarify"
    ) {
      if (!(await ensureGemmaAvailable(response))) return;

      const context = validateClarificationRequest(
        await readJson(request),
      );
      const outcome = await clarifyWithGemma(context);

      console.log(
        `[Gemma clarification] ${JSON.stringify({
          kind: outcome.kind,
          action:
            outcome.kind === "updated_action"
              ? outcome.action.action
              : undefined,
        })}`,
      );

      return sendJson(response, 200, outcome);
    }

    return sendJson(response, 404, {
      message: "Ruta no encontrada.",
    });
  } catch (error) {
    console.error("[AI server]", error);
    return sendJson(response, 500, {
      code: "AI_SERVER_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Error del servidor de IA.",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `Servidor de IA v${APP_VERSION} listo en http://127.0.0.1:${PORT}`,
  );
  console.log(`Modelo configurado: ${OLLAMA_MODEL}`);
  console.log(`PID del servidor IA: ${process.pid}`);
});
