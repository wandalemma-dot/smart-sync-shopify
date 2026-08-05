// Cliente único para hablar con Shopify a través del proxy /api/shopify.
// Antes había dos versiones casi idénticas (fetchShopifyGraphQL en syncLogic.ts
// y shopifyGraphQL en restockLogic.ts). Ahora las dos usan esta.

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
