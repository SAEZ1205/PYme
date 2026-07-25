function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastTurn(history, role) {
  if (!Array.isArray(history)) return "";

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
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

export function isDataRecommendationRequest(value) {
  const text = normalizeText(value);

  return (
    /\b(segun|basado en|con)\s+(mis|los)\s+(datos|ventas|gastos|resultados|movimientos)\b/.test(
      text,
    ) ||
    /\b(analiza|revisa|evalua)\s+(mis|los)\s+(datos|ventas|gastos|resultados|fiados|costos)\b/.test(
      text,
    ) ||
    /\b(que|como)\s+(puedo|debo|podria)\s+mejorar\b/.test(text) ||
    /\bque deberia priorizar\b/.test(text) ||
    /\brecomendaciones del negocio\b/.test(text) ||
    /\brecomendaciones segun\b/.test(text) ||
    /\bque me recomiendas mejorar\b/.test(text)
  );
}

export function isBusinessIdeaRequest(context) {
  const text = normalizeText(context?.text);

  if (!text || isDataRecommendationRequest(text)) {
    return false;
  }

  const directIdea =
    (
      /\b(que otras cosas|que mas|que otros productos|que productos|cuales productos)\b/.test(
        text,
      ) &&
      /\b(vender|ofrecer|agregar|comprar|incorporar)\b/.test(text)
    ) ||
    /\bque (me )?recomiendas (comprar|vender|ofrecer)\b/.test(text) ||
    /\bideas? (de|para) productos?\b/.test(text) ||
    /\bproductos? (para|que podria) vender\b/.test(text) ||
    /\bcomo (puedo|podria) ampliar (mi|la) oferta\b/.test(text) ||
    /\bque podria ofrecer\b/.test(text) ||
    /\bdiversificar\b/.test(text);

  if (directIdea) {
    return true;
  }

  const lastAssistant = normalizeText(
    lastTurn(context?.conversationHistory, "assistant"),
  );

  const previousQuestionAskedForIdeas =
    /\b(que tipo de productos|que productos|que categoria|que te gustaria vender|tienes algun producto en mente|que otras cosas)\b/.test(
      lastAssistant,
    );

  const currentLooksLikeCategory =
    text.length <= 120 &&
    !/\b(vendi|compre|gaste|fie|pague|registrar|anular)\b/.test(
      text,
    );

  return previousQuestionAskedForIdeas && currentLooksLikeCategory;
}

export function containsInternalDataContamination(value) {
  const text = normalizeText(value);

  return (
    /\bproducto estrella\b/.test(text) ||
    /\blidera las ventas\b/.test(text) ||
    /\brepresenta el \d+ ?% de (tus|las) ventas\b/.test(text) ||
    /\bventas actuales\b/.test(text) ||
    /\bfiados? pendientes?\b/.test(text) ||
    /\bdeuda pendiente\b/.test(text) ||
    /\bsin costo registrado\b/.test(text) ||
    /\bsegun los datos registrados\b/.test(text)
  );
}

function barberShopFallback() {
  return {
    responseText:
      "Para complementar una barbería, empezaría con productos que puedas mostrar y usar durante el servicio:\n\n" +
      "1. Pomadas o ceras de fijación.\n" +
      "2. Polvo texturizante.\n" +
      "3. Shampoo de uso frecuente y acondicionador.\n" +
      "4. Aceite o bálsamo para barba.\n" +
      "5. Aftershave o loción postafeitado.\n" +
      "6. Sérum capilar o protector térmico.\n\n" +
      "No compraría muchas variedades al inicio. Probaría cuatro categorías, con pocas unidades de cada una, durante dos o tres semanas. Conviene aplicar el producto al finalizar el corte y explicar qué resultado aporta; así la venta nace del servicio y no de ofrecer artículos al azar.",
    suggestedPrompts: [
      "Dame una lista inicial con pocas unidades",
      "Ayúdame a elegir las cuatro primeras categorías",
      "¿Cómo puedo ofrecerlos después del corte?",
      "Ayúdame a definir un presupuesto",
    ],
  };
}

export function buildBusinessIdeaFallback(context) {
  const combined = normalizeText(
    [
      context?.text,
      ...(Array.isArray(context?.conversationHistory)
        ? context.conversationHistory.map((turn) => turn?.content ?? "")
        : []),
    ].join(" "),
  );

  if (
    /\b(barberia|barbero|cabello|pelo|barba|corte de cabello)\b/.test(
      combined,
    )
  ) {
    return barberShopFallback();
  }

  return {
    responseText:
      "Para ampliar la oferta, conviene elegir productos que complementen el servicio principal y que puedas explicar o demostrar al cliente. Empezaría con tres o cuatro categorías, pocas unidades y un periodo corto de prueba. Después compararía rotación, margen y comentarios de los clientes antes de ampliar el catálogo.",
    suggestedPrompts: [
      "Dame categorías concretas para mi negocio",
      "Ayúdame a definir una prueba pequeña",
      "¿Cómo calculo cuánto comprar al inicio?",
    ],
  };
}
