export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { query, variables } = req.body;

  try {
    const response = await fetch('https://indy-com-ar.myshopify.com/admin/api/2024-04/graphql.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': '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'
      },
      body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Shopify API Error:', error);
    return res.status(500).json({ error: 'Failed to fetch from Shopify' });
  }
}
