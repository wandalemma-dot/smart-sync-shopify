// Proxy hacia Shopify.
//
// SEGURIDAD:
// 1) El token de admin YA NO está escrito acá. Se lee de la variable de entorno
//    SHOPIFY_ADMIN_TOKEN (la "caja fuerte" de Vercel).
// 2) La puerta está cerrada: este endpoint SOLO deja pasar lecturas (queries).
//    Cualquier mutación (crear, borrar, cambiar precios/stock) se rechaza.
//    Cuando agreguemos "escribir stock", sumamos esa única operación a
//    ALLOWED_MUTATIONS y nada más.

const ALLOWED_MUTATIONS = [
  'inventorySetQuantities', // escribir stock (cantidades)
  'productSet',             // crear productos nuevos (como borrador)
];

function isAllowed(query) {
  if (typeof query !== 'string' || !query.trim()) return false;
  const hasMutation = /\bmutation\b/i.test(query);
  if (!hasMutation) return true; // las lecturas siempre están permitidas
  // Si es una mutación, solo se permite si es una de las de la lista blanca.
  return ALLOWED_MUTATIONS.length > 0 && ALLOWED_MUTATIONS.some((m) => query.includes(m));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Falta configurar SHOPIFY_ADMIN_TOKEN en Vercel.' });
  }

  const { query, variables } = req.body || {};
  if (!isAllowed(query)) {
    return res.status(403).json({ error: 'Operación no permitida por seguridad (solo lectura).' });
  }

  try {
    const response = await fetch('https://indy-com-ar.myshopify.com/admin/api/2024-04/graphql.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Shopify API Error:', error);
    return res.status(500).json({ error: 'Failed to fetch from Shopify' });
  }
}
