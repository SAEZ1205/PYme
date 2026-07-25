import type {
  Customer,
  PaymentMethod,
  Product,
  PurchasePurpose,
} from "../types/domain";

const NUMBER_WORDS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
};

export const NUMBER_PATTERN =
  String.raw`(?:\d+(?:\.\d+)?|cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)`;

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[¿?¡!,;:()[\]{}]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseNumberValue(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS[normalized] ?? null;
}

export function parseFirstNumber(value: string): number | null {
  const match = normalizeText(value).match(new RegExp(NUMBER_PATTERN));
  return parseNumberValue(match?.[0]);
}

export function parsePaymentMethod(value: string): PaymentMethod | null {
  const text = normalizeText(value);
  if (text.includes("yape")) return "yape";
  if (text.includes("plin")) return "plin";
  if (
    text.includes("efectivo") ||
    text.includes("cash") ||
    text.includes("contado")
  ) {
    return "cash";
  }
  return null;
}

export function parsePurchasePurpose(
  value: string,
): PurchasePurpose | null {
  const text = normalizeText(value);
  if (
    text.includes("para vender") ||
    text.includes("mercaderia") ||
    text.includes("reventa")
  ) {
    return "merchandise";
  }
  if (
    text.includes("insumo") ||
    text.includes("uso interno") ||
    text.includes("para trabajar")
  ) {
    return "internal_supply";
  }
  if (
    text.includes("gasto del negocio") ||
    text.includes("consumo del negocio")
  ) {
    return "business_expense";
  }
  return null;
}

function singularToken(value: string): string {
  const token = value.trim();
  if (token.endsWith("ces") && token.length > 5) {
    return `${token.slice(0, -3)}z`;
  }
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function significantTokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map(singularToken)
    .filter((token) => token.length >= 3);
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );

  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    matrix[0]![column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost =
        left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + substitutionCost,
      );
    }
  }

  return matrix[rows - 1]![columns - 1]!;
}

function productTokenScore(
  productToken: string,
  operationToken: string,
): number {
  if (productToken === operationToken) return 30;

  if (
    productToken.length >= 4 &&
    operationToken.length >= 4 &&
    (productToken.startsWith(operationToken) ||
      operationToken.startsWith(productToken))
  ) {
    return 20;
  }

  if (
    productToken.length >= 5 &&
    operationToken.length >= 5 &&
    editDistance(productToken, operationToken) <= 1
  ) {
    return 16;
  }

  return 0;
}

export function findProductMention(
  value: string,
  products: Product[],
): Product | null {
  const text = normalizeText(value);
  const textTokens = text.split(" ").map(singularToken);

  const ranked = products
    .filter((product) => product.active)
    .map((product) => {
      const normalizedName = normalizeText(product.name);
      const tokens = significantTokens(product.name);
      let score = text.includes(normalizedName)
        ? 120 + normalizedName.length
        : 0;

      for (const productToken of tokens) {
        const bestTokenScore = Math.max(
          0,
          ...textTokens.map((operationToken) =>
            productTokenScore(productToken, operationToken),
          ),
        );
        score += bestTokenScore;
      }

      return { product, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.product.name.length - a.product.name.length,
    );

  return ranked[0]?.product ?? null;
}

function formatInferredProductName(rawValue: string): string {
  const normalized = normalizeText(rawValue)
    .split(" ")
    .map((token) => {
      const singular = singularToken(token);
      return /^[a-z]+\d+$/i.test(singular)
        ? singular.toUpperCase()
        : singular;
    })
    .join(" ")
    .trim();

  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function extractOperationProductName(
  value: string,
): string | null {
  const text = normalizeText(value);
  const pattern = new RegExp(
    String.raw`(?:vendi|vendimos|vendio|fie|fiamos|compre|compramos)\s+${NUMBER_PATTERN}\s+(.+?)(?=\s+(?:a|por|cada|y|con|pague|pagaron|pago)\b|$)`,
  );
  const rawName = text.match(pattern)?.[1]?.trim();

  if (!rawName || rawName.length < 2) return null;

  const ignored = new Set([
    "producto",
    "productos",
    "articulo",
    "articulos",
    "servicio",
    "servicios",
  ]);
  if (ignored.has(rawName)) return null;

  return formatInferredProductName(rawName);
}

export function findCustomerMention(
  value: string,
  customers: Customer[],
): Customer | null {
  const text = normalizeText(value);
  const ranked = customers
    .filter((customer) => customer.active)
    .map((customer) => {
      const normalizedName = normalizeText(customer.name);
      const tokens = normalizedName
        .split(" ")
        .filter((token) => token.length >= 3);
      let score = text.includes(normalizedName)
        ? 100 + normalizedName.length
        : 0;
      for (const token of tokens) {
        if (text.split(" ").includes(token)) score += 20;
      }
      return { customer, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.customer ?? null;
}

export function extractCustomerName(value: string): string | null {
  const text = normalizeText(value);
  const patterns = [
    /(?:cliente|a nombre de)\s+([a-z][a-z\s]{1,45}?)(?=\s+(?:por|pago|debe|con|telefono|nota|$))/,
    /^([a-z][a-z\s]{1,45}?)\s+(?:pago|abona|abono|cancelo|dio)\b/,
    /(?:fie|fiamos|fiado|credito)\b.*?\s+a\s+([a-z][a-z\s]{1,45}?)(?=\s+(?:por|a|total|y|con|vence|$))/,
    /\s+a\s+([a-z][a-z\s]{1,45}?)(?=\s+(?:por|total|y|con|vence|$))/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = match?.[1]?.trim();
    if (name && name.length >= 2) {
      return name.replace(/\b(el|la|los|las|un|una)$/g, "").trim();
    }
  }
  return null;
}

export function extractQuantity(
  value: string,
  product?: Product | null,
): number | null {
  const text = normalizeText(value);
  const afterVerb = text.match(
    new RegExp(
      String.raw`(?:vendi|vendio|vendimos|compre|compramos|fie|fiamos|cantidad)\s+(${NUMBER_PATTERN})`,
    ),
  );
  if (afterVerb) return parseNumberValue(afterVerb[1]);

  if (product) {
    const token = significantTokens(product.name)[0];
    if (token) {
      const beforeProduct = text.match(
        new RegExp(String.raw`(${NUMBER_PATTERN})\s+\w*${token}\w*`),
      );
      if (beforeProduct) return parseNumberValue(beforeProduct[1]);
    }
  }

  return null;
}

export function extractUnitPrice(value: string): number | null {
  const text = normalizeText(value);
  const patterns = [
    new RegExp(
      String.raw`(?:cada(?:\s+uno|\s+una)?\s*(?:a|por)?|precio(?:\s+de\s+venta)?|a)\s+(${NUMBER_PATTERN})\s*(?:soles?|s\/)?`,
    ),
    new RegExp(
      String.raw`(${NUMBER_PATTERN})\s*(?:soles?|s\/)\s+(?:cada|por unidad)`,
    ),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = parseNumberValue(match?.[1]);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function extractTotalAmount(value: string): number | null {
  const text = normalizeText(value);
  const patterns = [
    new RegExp(
      String.raw`(?:total|pague|pagamos|gaste|gasto|por)\s+(${NUMBER_PATTERN})\s*(?:soles?|s\/)`,
    ),
    new RegExp(String.raw`(${NUMBER_PATTERN})\s*(?:soles?|s\/)`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = parseNumberValue(match?.[1]);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function parseYesNo(value: string): boolean | null {
  const text = normalizeText(value);

  if (
    text === "no" ||
    text.includes("sin stock") ||
    text.includes("sin control") ||
    text.includes("no controlar") ||
    text.includes("desactivar")
  ) {
    return false;
  }

  if (
    text === "si" ||
    text.includes("claro") ||
    text.includes("activar") ||
    text.includes("controlar stock") ||
    text.includes("con stock")
  ) {
    return true;
  }

  return null;
}
