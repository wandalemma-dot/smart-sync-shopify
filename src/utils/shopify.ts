// Cliente único para hablar con Shopify a través del proxy /api/shopify.
// Antes había dos versiones casi idénticas (fetchShopifyGraphQL en syncLogic.ts
// y shopifyGraphQL en restockLogic.ts). Ahora las dos usan esta.

// ---- COMPARAR NOMBRES DE SUCURSAL ----
// Wanda les pone emojis y símbolos a las sucursales en Shopify (ej.
// "🔴 ID (Converse - Le Coq Sportif)"). Si comparáramos el texto exacto, la app
// dejaría de encontrarlas cada vez que cambia el formato del nombre.
// Por eso comparamos solo letras y números.
export function normalizarSucursal(nombre: string): string {
  return String(nombre || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
    .replace(/[^A-Z0-9]/g, '');                        // saca emojis, espacios y símbolos
}

export function mismaSucursal(a: string, b: string): boolean {
  const na = normalizarSucursal(a);
  const nb = normalizarSucursal(b);
  return !!na && !!nb && na === nb;
}

export async function shopifyGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch('/api/shopify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const rawText = await res.text();
    console.error('Shopify Raw Error:', rawText);
    throw new Error(`Error de conexión con Shopify (${res.status}): ${rawText.substring(0, 120)}`);
  }

  const json = await res.json();
  if (json.errors) {
    console.error(json.errors);
    throw new Error('Shopify error: ' + JSON.stringify(json.errors));
  }
  return json.data as T;
}
