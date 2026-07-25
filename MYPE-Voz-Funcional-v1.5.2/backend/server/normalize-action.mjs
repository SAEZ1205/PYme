import { ACTION_NAMES } from "./ai-schema.mjs";

const QUERY_ACTIONS = new Set([
  "query_today_summary",
  "query_inventory",
  "query_cash",
  "query_report",
  "query_projection",
  "query_recommendations",
  "query_debts",
  "conversation",
  "unsupported",
]);

const PAYMENT_METHODS = new Set(["cash", "yape", "plin", "credit"]);
const EXPENSE_CATEGORIES = new Set([
  "rent",
  "utilities",
  "transport",
  "maintenance",
  "supplier_payment",
  "other",
]);
const PURCHASE_PURPOSES = new Set([
  "merchandise",
  "internal_supply",
  "business_expense",
]);
const REPORT_PERIODS = new Set(["today", "7days", "30days", "all"]);

const MUTATING_ACTIONS = new Set([
  "register_sale",
  "register_expense",
  "register_purchase",
  "create_product",
  "edit_product",
  "adjust_stock",
  "deactivate_product",
  "create_customer",
  "register_credit_sale",
  "register_debt_payment",
  "cancel_operation",
]);

const NUMBER_WORDS = new Map([
  ["un", 1],
  ["una", 1],
  ["uno", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
  ["diez", 10],
  ["once", 11],
  ["doce", 12],
  ["trece", 13],
  ["catorce", 14],
  ["quince", 15],
  ["veinte", 20],
]);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singular(token) {
  if (token.endsWith("ces") && token.length > 5) {
    return `${token.slice(0, -3)}z`;
  }
  if (token.endsWith("es") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function canonicalProductName(value) {
  const words = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);

  const normalizedWords = words.map((word) => singular(word.toLowerCase()));
  const joined = normalizedWords.join(" ");
  if (!joined) return null;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function editDistance(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let column = 0; column < columns; column += 1) {
    matrix[0][column] = column;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }
  return matrix[rows - 1][columns - 1];
}

function fuzzyEntityByName(name, entities) {
  const sought = normalize(name);
  if (!sought) return null;
  const soughtTokens = sought.split(" ").map(singular).filter(Boolean);
  const ranked = entities
    .map((entity) => {
      const entityName = normalize(entity.name);
      const entityTokens = entityName.split(" ").map(singular).filter(Boolean);
      let score = entityName === sought ? 200 : 0;
      if (entityName.includes(sought) || sought.includes(entityName)) {
        score += 100;
      }
      for (const left of soughtTokens) {
        for (const right of entityTokens) {
          if (left === right) score += 30;
          else if (
            left.length >= 4 &&
            right.length >= 4 &&
            (left.startsWith(right) || right.startsWith(left))
          ) {
            score += 18;
          } else if (
            left.length >= 5 &&
            right.length >= 5 &&
            editDistance(left, right) <= 1
          ) {
            score += 14;
          }
        }
      }
      return { entity, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score < 20) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 8) return null;
  return ranked[0].entity;
}

function validId(id, entities) {
  return typeof id === "string" &&
    entities.some((entity) => entity.id === id)
    ? id
    : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}



function titleCase(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseNumberToken(value) {
  const token = normalize(value).split(" ")[0] ?? "";
  if (!token) return null;

  if (/^\d+(?:[.,]\d+)?$/.test(token)) {
    const parsed = Number(token.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return NUMBER_WORDS.get(token) ?? null;
}

function isSocialConversation(text) {
  return (
    /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|ola)(\s+.*)?$/.test(
      text,
    ) ||
    /^(como estas|como te va|que tal|todo bien|quien eres|que puedes hacer|gracias|muchas gracias|hasta luego|chau|adios)[? ]*$/.test(
      text,
    ) ||
    /\b(como estas|como te encuentras)\b/.test(text)
  );
}

function socialConversationResponse(text) {
  if (/\b(gracias|muchas gracias)\b/.test(text)) {
    return {
      message:
        "Con gusto. Estoy aquí para ayudarte a registrar operaciones, entender tus resultados y decidir qué conviene revisar en el negocio.",
      prompts: [
        "¿Cómo nos fue hoy?",
        "¿Qué debería priorizar ahora?",
        "Quiero registrar una operación",
      ],
    };
  }

  if (/\b(quien eres|que puedes hacer)\b/.test(text)) {
    return {
      message:
        "Soy el asistente de MYPE Voz. Puedo registrar ventas, gastos, compras y fiados; además puedo analizar Caja, inventario, reportes y darte recomendaciones usando tus datos reales.",
      prompts: [
        "¿Cómo nos fue hoy?",
        "Analiza mis gastos",
        "Quiero registrar una venta",
      ],
    };
  }

  if (/\b(chau|adios|hasta luego)\b/.test(text)) {
    return {
      message:
        "Hasta luego. Tu historial y los datos del negocio quedan guardados localmente para continuar después.",
      prompts: [],
    };
  }

  if (/\b(como estas|como te va|que tal|todo bien)\b/.test(text)) {
    return {
      message:
        "Estoy bien y listo para ayudarte con el negocio. Podemos registrar lo que ocurrió, revisar tus resultados o pensar en el siguiente paso.",
      prompts: [
        "¿Cómo nos fue hoy?",
        "¿Qué debería priorizar ahora?",
        "Quiero registrar una venta",
      ],
    };
  }

  return {
    message:
      "¡Hola! Estoy listo para ayudarte con el negocio. Puedes registrar una operación, preguntarme por tus resultados o conversar sobre una decisión.",
    prompts: [
      "¿Cómo nos fue hoy?",
      "¿Qué me recomiendas mejorar?",
      "Quiero registrar una venta",
    ],
  };
}


function isCreditCorrection(text) {
  return (
    /\b(no era|no fue)\s+(una\s+)?venta\b/.test(text) ||
    /\b(te dije|dije|dije que era|era|fue|es)\s+(fiado|fiada|a credito|al credito)\b/.test(
      text,
    ) ||
    /\b(no.*venta.*fiado|venta.*no.*fiado)\b/.test(text)
  );
}

function previousOperationalUserMessage(
  operationalHistory,
  conversationHistory,
) {
  if (Array.isArray(operationalHistory)) {
    for (
      let index = operationalHistory.length - 1;
      index >= 0;
      index -= 1
    ) {
      const message = operationalHistory[index];

      if (
        typeof message === "string" &&
        message.trim()
      ) {
        return message.trim();
      }
    }
  }

  if (!Array.isArray(conversationHistory)) {
    return null;
  }

  for (
    let index = conversationHistory.length - 1;
    index >= 0;
    index -= 1
  ) {
    const turn = conversationHistory[index];

    if (
      turn?.role === "user" &&
      typeof turn.content === "string" &&
      /\b(fie|fiamos|fio|vendi|vendimos|compre|compramos|gaste|gastamos)\b/.test(
        normalize(turn.content),
      )
    ) {
      return turn.content;
    }
  }

  return null;
}

const QUANTITY_OR_ARTICLE_PATTERN =
  "(?:\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte)";

function extractLeadingCustomer(remainder, customers = []) {
  const normalizedRemainder = normalize(remainder);
  const prefixMatch = normalizedRemainder.match(/^(?:a|para)\s+(.+)$/);

  if (!prefixMatch?.[1]) {
    return {
      customerName: null,
      remainder: normalizedRemainder,
    };
  }

  const afterPrefix = prefixMatch[1].trim();

  // Existing customers are the safest match, including multiword names.
  const knownCustomer = [...customers]
    .filter(
      (customer) =>
        customer &&
        typeof customer.name === "string" &&
        customer.name.trim(),
    )
    .sort(
      (left, right) =>
        normalize(right.name).length - normalize(left.name).length,
    )
    .find((customer) => {
      const knownName = normalize(customer.name);
      return (
        afterPrefix === knownName ||
        afterPrefix.startsWith(`${knownName} `)
      );
    });

  if (knownCustomer) {
    const knownName = normalize(knownCustomer.name);
    return {
      customerName: knownCustomer.name,
      remainder: afterPrefix.slice(knownName.length).trim(),
    };
  }

  // New customers: "a sebastian una gaseosa", "a maria lopez 2 cuadernos".
  const genericPattern = new RegExp(
    `^(.+?)\\s+(?=${QUANTITY_OR_ARTICLE_PATTERN}\\b)`,
  );
  const genericMatch = afterPrefix.match(genericPattern);

  if (!genericMatch?.[1]) {
    return {
      customerName: null,
      remainder: normalizedRemainder,
    };
  }

  const customerName = titleCase(genericMatch[1]);
  return {
    customerName,
    remainder: afterPrefix.slice(genericMatch[0].length).trim(),
  };
}

function extractEmbeddedCustomer(remainder, customers = []) {
  const normalizedRemainder = normalize(remainder);

  const known = [...customers]
    .filter((customer) => customer && typeof customer.name === "string")
    .sort(
      (left, right) =>
        normalize(right.name).length - normalize(left.name).length,
    );

  for (const customer of known) {
    const customerName = normalize(customer.name);
    const escaped = customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      String.raw`(?:^|\s)(?:a|para)\s+${escaped}(?=\s+(?:por|a|de)\s+(?:\d|un\b|una\b|uno\b|dos\b|tres\b|cuatro\b|cinco\b|seis\b|siete\b|ocho\b|nueve\b|diez\b|once\b|doce\b|trece\b|catorce\b|quince\b|veinte\b)|$)`,
    );
    if (pattern.test(normalizedRemainder)) {
      return {
        customerName: customer.name,
        remainder: normalizedRemainder.replace(pattern, " ").replace(/\s+/g, " ").trim(),
      };
    }
  }

  const generic = normalizedRemainder.match(
    /(?:^|\s)(?:a|para)\s+([a-z]+(?:\s+[a-z]+){0,2}?)(?=\s+(?:por|a|de)\s+(?:\d|un\b|una\b|uno\b|dos\b|tres\b|cuatro\b|cinco\b|seis\b|siete\b|ocho\b|nueve\b|diez\b|once\b|doce\b|trece\b|catorce\b|quince\b|veinte\b))/,
  );

  if (!generic?.[1]) {
    return { customerName: null, remainder: normalizedRemainder };
  }

  return {
    customerName: titleCase(generic[1]),
    remainder: normalizedRemainder
      .replace(generic[0], " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function customerNameFromRawText(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(
    /(?:\b(?:a|para)\s+)([\p{L}][\p{L}\s]{1,50})\s*$/iu,
  );

  if (!match?.[1]) return null;

  return titleCase(
    match[1]
      .replace(
        /^(?:el|la|los|las|cliente|señor|señora|sr|sra)\s+/iu,
        "",
      )
      .trim(),
  );
}

function hasCreditSaleIntent(text) {
  return /\b(fie|fiamos|fio|fiado|fiada|a credito|al credito)\b/.test(text);
}

function extractCreditSaleFromCurrentText(value, customers = []) {
  const rawText = String(value ?? "").trim();
  const normalized = normalize(rawText);
  const verbMatch = normalized.match(
    /\b(fie|fiamos|fio|fiado|fiada)\b\s+(.+)$/,
  );

  if (!verbMatch) {
    return {
      quantity: null,
      productName: null,
      unitPrice: null,
      customerName: null,
    };
  }

  let remainder = verbMatch[2].trim();
  let quantity = null;

  const leadingCustomer = extractLeadingCustomer(
    remainder,
    customers,
  );
  let customerName = leadingCustomer.customerName;
  remainder = leadingCustomer.remainder;

  const firstToken = remainder.split(" ")[0] ?? "";
  const parsedQuantity = parseNumberToken(firstToken);

  if (parsedQuantity !== null && parsedQuantity > 0) {
    quantity = parsedQuantity;
    remainder = remainder.slice(firstToken.length).trim();
  }

  const embeddedCustomer = extractEmbeddedCustomer(
    remainder,
    customers,
  );
  if (!customerName && embeddedCustomer.customerName) {
    customerName = embeddedCustomer.customerName;
  }
  remainder = embeddedCustomer.remainder;

  const trailingCustomer = customerNameFromRawText(rawText);
  if (!customerName && trailingCustomer) {
    customerName = trailingCustomer;
  }

  // Remove a final customer phrase when the client appears after the product.
  if (trailingCustomer) {
    const normalizedCustomer = normalize(trailingCustomer);
    const customerPattern = new RegExp(
      String.raw`\s+(?:a|para)\s+${normalizedCustomer.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )}\s*$`,
    );
    remainder = remainder.replace(customerPattern, "").trim();
  }

  let unitPrice = null;
  let productSegment = remainder;

  // Explicit unit-price expressions:
  // "de 2 soles cada uno", "a 2 soles c/u", "2 soles por unidad".
  const unitPriceMatch = remainder.match(
    /\b(?:a|de|por)?\s*(\d+(?:[.,]\d+)?)\s+(?:soles?|sles?|soels?|goles?)\s*(?:cada\s+uno|cada\s+una|c\/u|por\s+unidad|la\s+unidad)\b/,
  );

  if (unitPriceMatch?.[1]) {
    unitPrice = Number(unitPriceMatch[1].replace(",", "."));
    if (unitPriceMatch.index !== undefined) {
      productSegment = remainder.slice(0, unitPriceMatch.index).trim();
    }
  } else {
    // "3 lapices a 2 soles" is unit price.
    const atPriceMatch = remainder.match(
      /\b(?:a|de)\s+(\d+(?:[.,]\d+)?)\s+(?:soles?|sles?|soels?|goles?)\b/,
    );

    if (atPriceMatch?.[1]) {
      unitPrice = Number(atPriceMatch[1].replace(",", "."));
      if (atPriceMatch.index !== undefined) {
        productSegment = remainder.slice(0, atPriceMatch.index).trim();
      }
    } else {
      // "3 lapices por 6 soles" is treated as total.
      const totalMatch = remainder.match(
        /\bpor\s+(\d+(?:[.,]\d+)?)\s+(?:soles?|sles?|soels?|goles?)\b/,
      );

      if (totalMatch?.[1]) {
        const total = Number(totalMatch[1].replace(",", "."));
        const resolvedQuantity =
          quantity !== null && quantity > 0 ? quantity : 1;
        unitPrice = total / resolvedQuantity;

        if (totalMatch.index !== undefined) {
          productSegment = remainder.slice(0, totalMatch.index).trim();
        }
      }
    }
  }

  productSegment = productSegment
    .replace(/\b(?:cada\s+uno|cada\s+una|c\/u|por\s+unidad)\b.*$/g, "")
    .replace(/\b(?:al|a la|para el cliente)\b.*$/g, "")
    .trim();

  const productName = productSegment
    ? canonicalProductName(productSegment)
    : null;

  const safeQuantity =
    quantity !== null && Number.isInteger(quantity)
      ? quantity
      : quantity === null
        ? 1
        : null;

  return {
    quantity: safeQuantity,
    productName,
    unitPrice:
      unitPrice !== null && Number.isFinite(unitPrice) && unitPrice > 0
        ? unitPrice
        : null,
    customerName,
  };
}

function supportsMutatingAction(action, text) {
  if (action === "register_credit_sale") {
    return hasCreditSaleIntent(text);
  }
  if (action === "register_sale") {
    return /\b(vendi|vendimos|vendio|registre una venta|registrar una venta|registra una venta|anota una venta|cobre)\b/.test(
      text,
    );
  }
  if (action === "register_expense") {
    return /\b(gaste|gastamos|pague|pagamos|registre un gasto|registrar un gasto|registra un gasto|anota un gasto)\b/.test(
      text,
    );
  }
  if (action === "register_purchase") {
    return /\b(compre|compramos|adquiri|registre una compra|registrar una compra|registra una compra|anota una compra)\b/.test(
      text,
    );
  }
  if (action === "create_product") {
    return /\b(crea|crear|agrega|agregar|registra|registrar)\b.*\b(producto|servicio|articulo)\b/.test(
      text,
    );
  }
  if (action === "edit_product") {
    return /\b(cambia|cambiar|edita|editar|modifica|modificar)\b/.test(
      text,
    );
  }
  if (action === "adjust_stock") {
    return /\b(ajusta|ajustar|corrige|corregir|pon|establece)\b.*\bstock\b/.test(
      text,
    );
  }
  if (action === "deactivate_product") {
    return /\b(desactiva|desactivar|elimina|eliminar|borra|borrar)\b.*\b(producto|catalogo|articulo)\b/.test(
      text,
    );
  }
  if (action === "create_customer") {
    return /\b(crea|crear|agrega|agregar|registra|registrar)\b.*\bcliente\b/.test(
      text,
    );
  }
  if (action === "register_debt_payment") {
    return /\b(pago|pago|abona|abono|cancelo)\b.*\b(deuda|fiado|saldo)\b/.test(
      text,
    );
  }
  if (action === "cancel_operation") {
    return hasCancellationIntent(text);
  }
  return true;
}

function clearOperationalFields(raw) {
  return {
    ...raw,
    action: "unsupported",
    productId: null,
    productName: null,
    createProductIfMissing: false,
    quantity: null,
    unitPrice: null,
    paymentMethod: null,
    customerId: null,
    customerName: null,
    amount: null,
    operationId: null,
    operationType: null,
    responseText: null,
    suggestedPrompts: [],
    warnings: [],
  };
}

function isGreeting(text) {
  return /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|ola)(\s+.*)?$/.test(
    text,
  );
}

function hasCancellationIntent(text) {
  const cancelVerb =
    /\b(elimina|eliminar|borra|borrar|anula|anular|deshaz|deshacer|cancela|cancelar|revierte|revertir)\b/.test(
      text,
    );
  const operationWord =
    /\b(operacion|movimiento|venta|compra|gasto|registro|anterior|ultima|ultimo|previa|previo)\b/.test(
      text,
    );
  const explicitProduct =
    /\b(producto|catalogo|articulo)\b/.test(text) &&
    !/\b(venta|compra|gasto|operacion|movimiento)\b/.test(text);

  return cancelVerb && operationWord && !explicitProduct;
}

function requestedOperationType(text) {
  if (/\bcompra\b/.test(text)) return "purchase";
  if (/\bgasto\b/.test(text)) return "expense";
  if (/\bventa\b/.test(text)) return "sale";
  return null;
}

function operationTypeLabel(type) {
  if (type === "sale") return "venta";
  if (type === "purchase") return "compra";
  return "gasto";
}

function operationDescription(operation) {
  return `${operationTypeLabel(operation.type)} “${operation.summary}” por S/ ${Number(
    operation.amount,
  ).toFixed(2)}`;
}

function forceConversation(raw, message, suggestedPrompts = []) {
  return {
    ...raw,
    action: "conversation",
    responseText: message,
    suggestedPrompts,
    operationId: null,
    operationType: null,
  };
}

function applySafetyOverrides(
  raw,
  originalText,
  recentOperations,
  conversationHistory,
  operationalHistory,
  customers,
) {
  const text = normalize(originalText);

  if (isSocialConversation(text)) {
    const response = socialConversationResponse(text);
    return forceConversation(
      raw,
      response.message,
      response.prompts,
    );
  }

  if (isCreditCorrection(text)) {
    const previousText = previousOperationalUserMessage(
      operationalHistory,
      conversationHistory,
    );

    if (previousText) {
      const extracted = extractCreditSaleFromCurrentText(
        previousText,
        customers,
      );

      if (
        extracted.productName &&
        extracted.quantity &&
        extracted.unitPrice
      ) {
        return {
          ...raw,
          action: "register_credit_sale",
          productId: null,
          productName: extracted.productName,
          createProductIfMissing: true,
          quantity: extracted.quantity,
          unitPrice: extracted.unitPrice,
          paymentMethod: "credit",
          customerId: null,
          customerName: extracted.customerName,
          responseText: null,
          suggestedPrompts: [],
          warnings: [
            "Corregí la interpretación anterior: la operación se preparará como venta fiada.",
          ],
        };
      }
    }

    return forceConversation(
      raw,
      "Entendido: la operación era fiada. Para evitar usar datos equivocados, vuelve a escribirla completa, por ejemplo: “Fié 3 lápices de 2 soles cada uno a Sebastián”.",
      ["Reescribir la venta fiada", "Cancelar esta corrección"],
    );
  }

  if (hasCreditSaleIntent(text)) {
    const extracted = extractCreditSaleFromCurrentText(
      originalText,
      customers,
    );

    return {
      ...raw,
      action: "register_credit_sale",
      productId: null,
      productName: extracted.productName,
      createProductIfMissing: Boolean(extracted.productName),
      quantity: extracted.quantity,
      unitPrice: extracted.unitPrice,
      paymentMethod: "credit",
      customerId: null,
      customerName: extracted.customerName,
      responseText: null,
      suggestedPrompts: [],
      warnings: [],
    };
  }

  if (
    MUTATING_ACTIONS.has(raw?.action) &&
    !supportsMutatingAction(raw.action, text)
  ) {
    return clearOperationalFields(raw);
  }

  if (!hasCancellationIntent(text)) {
    return raw;
  }

  const reversible = recentOperations.filter(
    (operation) =>
      operation.reversible && operation.status === "confirmed",
  );
  const requestedType = requestedOperationType(text);
  const target = requestedType
    ? reversible.find((operation) => operation.type === requestedType)
    : reversible[0];

  if (!target) {
    const latest = recentOperations[0];

    if (requestedType && latest) {
      return forceConversation(
        raw,
        `No encontré una ${operationTypeLabel(
          requestedType,
        )} reciente que pueda anular. La última operación registrada fue una ${operationDescription(
          latest,
        )}. ¿Deseas anular esa operación?`,
      );
    }

    return forceConversation(
      raw,
      "No encontré una operación reciente que pueda anular.",
    );
  }

  return {
    ...raw,
    action: "cancel_operation",
    operationId: target.id,
    operationType: target.type,
    responseText: null,
    warnings: [
      "La operación no se borrará del historial: quedará marcada como cancelada y se crearán movimientos de reversión.",
      ...(Array.isArray(raw?.warnings) ? raw.warnings : []),
    ],
  };
}

function makeUserMessage(action, data) {
  const product = data.productName ?? "el artículo";
  const messages = {
    register_sale: `Preparé una venta de ${product}.`,
    register_expense: "Preparé el registro del gasto.",
    register_purchase: `Preparé una compra de ${product}.`,
    create_product: "Preparé la creación del artículo.",
    edit_product: `Preparé cambios para ${product}.`,
    adjust_stock: `Preparé el ajuste de stock de ${product}.`,
    deactivate_product: `Preparé la desactivación de ${product}.`,
    query_today_summary: "Voy a revisar el resumen de hoy.",
    query_inventory: "Voy a revisar el inventario.",
    query_cash: "Voy a revisar los saldos de Caja.",
    query_report: "Voy a preparar el reporte solicitado.",
    query_projection: "Voy a calcular una proyección con los datos registrados.",
    query_recommendations: "Voy a revisar qué acciones podrían ayudar al negocio.",
    create_customer: "Preparé el registro del cliente.",
    register_credit_sale: `Preparé una venta fiada de ${product}.`,
    register_debt_payment: "Preparé el abono de la deuda.",
    query_debts: "Voy a revisar los fiados pendientes.",
    cancel_operation: "Preparé la anulación segura de la operación.",
    conversation: String(data.responseText ?? "¿En qué te ayudo?"),
    unsupported: "No pude convertir esa frase en una acción segura.",
  };
  return messages[action] ?? messages.unsupported;
}

function missingFieldsFor(action, data) {
  const missing = [];
  const require = (field, condition) => {
    if (!condition) missing.push(field);
  };

  switch (action) {
    case "register_sale":
      require(
        "productId",
        Boolean(
          data.productId ||
            (data.createProductIfMissing && data.productName),
        ),
      );
      require(
        "quantity",
        Number.isInteger(data.quantity) && data.quantity > 0,
      );
      require(
        "unitPrice",
        typeof data.unitPrice === "number" && data.unitPrice > 0,
      );
      require(
        "paymentMethod",
        ["cash", "yape", "plin"].includes(data.paymentMethod),
      );
      break;
    case "register_credit_sale":
      require(
        "productId",
        Boolean(
          data.productId ||
            (data.createProductIfMissing && data.productName),
        ),
      );
      require(
        "quantity",
        Number.isInteger(data.quantity) && data.quantity > 0,
      );
      require(
        "unitPrice",
        typeof data.unitPrice === "number" && data.unitPrice > 0,
      );
      require("customerName", Boolean(data.customerName));
      break;
    case "register_expense":
      require(
        "amount",
        typeof data.amount === "number" && data.amount > 0,
      );
      require(
        "paymentMethod",
        ["cash", "yape", "plin"].includes(data.paymentMethod),
      );
      break;
    case "register_purchase":
      require("productId", Boolean(data.productId));
      require(
        "quantity",
        Number.isInteger(data.quantity) && data.quantity > 0,
      );
      require(
        "unitCost",
        typeof data.unitCost === "number" && data.unitCost > 0,
      );
      require("purpose", PURCHASE_PURPOSES.has(data.purpose));
      require(
        "paymentMethod",
        ["cash", "yape", "plin"].includes(data.paymentMethod),
      );
      break;
    case "create_product":
      require("name", Boolean(data.name));
      require(
        "salePrice",
        typeof data.salePrice === "number" && data.salePrice > 0,
      );
      if (data.type === "product") {
        require("tracksStock", typeof data.tracksStock === "boolean");
        if (data.tracksStock) {
          require(
            "currentStock",
            Number.isInteger(data.currentStock) &&
              data.currentStock >= 0,
          );
        }
      }
      break;
    case "edit_product":
      require("productId", Boolean(data.productId));
      require(
        "editValue",
        data.salePrice != null ||
          data.purchaseCost != null ||
          data.tracksStock != null,
      );
      if (data.tracksStock === true && data.currentStock == null) {
        missing.push("currentStock");
      }
      break;
    case "adjust_stock":
      require("productId", Boolean(data.productId));
      require(
        "newStock",
        Number.isInteger(data.newStock) && data.newStock >= 0,
      );
      break;
    case "deactivate_product":
      require("productId", Boolean(data.productId));
      break;
    case "create_customer":
      require("customerName", Boolean(data.customerName));
      break;
    case "register_debt_payment":
      require("customerName", Boolean(data.customerName));
      require(
        "amount",
        typeof data.amount === "number" && data.amount > 0,
      );
      require(
        "paymentMethod",
        ["cash", "yape", "plin"].includes(data.paymentMethod),
      );
      break;
    case "cancel_operation":
      require("operationId", Boolean(data.operationId));
      require(
        "operationType",
        ["sale", "expense", "purchase"].includes(data.operationType),
      );
      break;
    case "conversation":
      require("responseText", Boolean(data.responseText));
      break;
    default:
      break;
  }

  return [...new Set(missing)];
}

export function normalizeGemmaAction(raw, context, originalText) {
  const products = Array.isArray(context.products)
    ? context.products
    : [];
  const customers = Array.isArray(context.customers)
    ? context.customers
    : [];
  const recentOperations = Array.isArray(context.recentOperations)
    ? context.recentOperations
    : [];

  const safeRaw = applySafetyOverrides(
    raw ?? {},
    originalText,
    recentOperations,
    Array.isArray(context.conversationHistory)
      ? context.conversationHistory
      : [],
    Array.isArray(context.operationalHistory)
      ? context.operationalHistory
      : [],
    customers,
  );

  const action = ACTION_NAMES.includes(safeRaw?.action)
    ? safeRaw.action
    : "unsupported";

  const suppliedProductId = validId(safeRaw?.productId, products);
  const suppliedCustomerId = validId(safeRaw?.customerId, customers);
  const productByName = fuzzyEntityByName(safeRaw?.productName, products);
  const customerByName = fuzzyEntityByName(safeRaw?.customerName, customers);
  const productId = suppliedProductId ?? productByName?.id ?? null;
  const customerId = suppliedCustomerId ?? customerByName?.id ?? null;

  let productName = productId
    ? products.find((item) => item.id === productId)?.name ??
      stringOrNull(safeRaw?.productName)
    : stringOrNull(safeRaw?.productName);

  const customerName = customerId
    ? customers.find((item) => item.id === customerId)?.name ??
      stringOrNull(safeRaw?.customerName)
    : stringOrNull(safeRaw?.customerName);

  const allowsImplicitCreation =
    action === "register_sale" ||
    action === "register_credit_sale";

  const createProductIfMissing = Boolean(
    allowsImplicitCreation &&
      safeRaw?.createProductIfMissing &&
      !productId &&
      productName,
  );

  if (createProductIfMissing) {
    productName = canonicalProductName(productName);
  }

  const paymentMethod = PAYMENT_METHODS.has(safeRaw?.paymentMethod)
    ? safeRaw.paymentMethod
    : null;

  const operationId = validId(
    safeRaw?.operationId,
    recentOperations,
  );
  const operation = operationId
    ? recentOperations.find((item) => item.id === operationId) ?? null
    : null;
  const operationType =
    operation?.type ??
    (["sale", "expense", "purchase"].includes(safeRaw?.operationType)
      ? safeRaw.operationType
      : null);

  const data = {
    productId: productId ?? undefined,
    productName: productName ?? undefined,
    createProductIfMissing,
    quantity: numberOrNull(safeRaw?.quantity),
    unitPrice: numberOrNull(safeRaw?.unitPrice),
    paymentMethod,
    customerId: customerId ?? undefined,
    customerName: customerName ?? undefined,
    amount: numberOrNull(safeRaw?.amount),
    category: EXPENSE_CATEGORIES.has(safeRaw?.expenseCategory)
      ? safeRaw.expenseCategory
      : "other",
    description: stringOrNull(safeRaw?.description) ?? originalText,
    purpose: PURCHASE_PURPOSES.has(safeRaw?.purchasePurpose)
      ? safeRaw.purchasePurpose
      : null,
    unitCost: numberOrNull(safeRaw?.unitCost),
    additionalCosts: Math.max(
      0,
      numberOrNull(safeRaw?.additionalCosts) ?? 0,
    ),
    supplierName: stringOrNull(safeRaw?.supplierName),
    purchasedAt: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
    name: stringOrNull(safeRaw?.newProductName),
    type: safeRaw?.productType === "service" ? "service" : "product",
    purchaseCost: numberOrNull(safeRaw?.purchaseCost),
    salePrice: numberOrNull(safeRaw?.salePrice),
    tracksStock: booleanOrNull(safeRaw?.tracksStock),
    currentStock: numberOrNull(safeRaw?.currentStock),
    minimumStock: numberOrNull(safeRaw?.minimumStock) ?? 0,
    newStock: numberOrNull(safeRaw?.newStock),
    reason: "Ajuste solicitado mediante Gemma",
    period: REPORT_PERIODS.has(safeRaw?.reportPeriod)
      ? safeRaw.reportPeriod
      : "today",
    phone: null,
    notes: null,
    dueDate: null,
    operationId: operation?.id ?? undefined,
    operationType: operationType ?? undefined,
    operationTitle: operation?.title,
    operationSummary: operation?.summary,
    operationAmount: operation?.amount,
    operationCreatedAt: operation?.createdAt,
    responseText: stringOrNull(safeRaw?.responseText),
    suggestedPrompts: Array.isArray(safeRaw?.suggestedPrompts)
      ? safeRaw.suggestedPrompts
          .filter(
            (item) =>
              typeof item === "string" &&
              item.trim().length > 0,
          )
          .map((item) => item.trim())
          .slice(0, 4)
      : [],
  };

  if (
    action === "conversation" &&
    /\b(?:registrando|he\s+registrado|ya\s+registr[eé]|registr[eé]|registramos|se\s+registr[oó]|voy\s+a\s+registrar|vamos\s+a\s+registrar|procedo\s+a\s+registrar|guardando|he\s+guardado|ya\s+guard[eé]|guard[eé]|actualizando|actualic[eé])\b/i.test(
      data.responseText ?? "",
    )
  ) {
    data.responseText =
      "Puedo preparar esa operación, pero todavía no se ha guardado. Las modificaciones requieren una tarjeta de revisión y tu confirmación.";
    data.suggestedPrompts = [
      "Reescribir la operación completa",
      "Ver operaciones recientes",
    ];
  }

  if (
    action === "conversation" &&
    !data.suggestedPrompts.length
  ) {
    data.suggestedPrompts = [
      "¿Cómo nos fue hoy?",
      "¿Qué me recomiendas mejorar?",
      "Muéstrame mis gastos recientes",
    ];
  }

  if (action !== "conversation") {
    data.suggestedPrompts = [];
  }

  if (action === "register_credit_sale") {
    data.paymentMethod = "credit";
  }

  if (action === "create_product" && data.type === "service") {
    data.tracksStock = false;
    data.currentStock = null;
    data.minimumStock = null;
  }

  const warnings = Array.isArray(safeRaw?.warnings)
    ? safeRaw.warnings
        .filter(
          (item) =>
            typeof item === "string" && item.trim(),
        )
        .slice(0, 5)
    : [];

  if (action === "register_credit_sale") {
    warnings.unshift(
      "La venta descontará inventario, pero no ingresará dinero a Caja hasta que el cliente pague.",
    );
  }

  if (
    (action === "register_sale" ||
      action === "register_credit_sale") &&
    data.createProductIfMissing
  ) {
    warnings.push(
      `${data.productName} no existe en el catálogo. Al confirmar, se creará con stock no registrado y costo pendiente.`,
    );
  }

  const requiresConfirmation = !QUERY_ACTIONS.has(action);

  return {
    id: crypto.randomUUID(),
    action,
    confidence: Math.max(
      0,
      Math.min(1, numberOrNull(safeRaw?.confidence) ?? 0.65),
    ),
    data,
    missingFields: missingFieldsFor(action, data),
    warnings: [...new Set(warnings)].slice(0, 5),
    requiresConfirmation,
    userMessage: makeUserMessage(action, data),
    originalText,
    createdAt: new Date().toISOString(),
  };
}
