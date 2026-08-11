// Genera un token de admin de Shopify por OAuth.
// IMPORTANTE: este archivo YA NO tiene el client secret escrito.
// Te lo pide al correr (o lo toma de la variable de entorno SHOPIFY_CLIENT_SECRET),
// así nunca vuelve a quedar un secreto en el repositorio.
//
// Uso:
//   node get-token.cjs
//   (te va a pedir que pegues el client secret nuevo)
//
// o pasándolo por variable de entorno:
//   SHOPIFY_CLIENT_SECRET=shpss_xxx node get-token.cjs

const http = require('http');
const url = require('url');
const readline = require('readline');

const clientId = '52788b0204c81f321e0c23c959793921'; // el Client ID no es secreto
const shop = 'indy-com-ar.myshopify.com';
const redirectUri = 'http://localhost:3000/callback';
// Scopes: incluye write_inventory (escribir stock) y read_orders/read_returns
// (ventas y devoluciones, para la pestaña de Reposición).
const scopes = 'write_products,read_products,write_inventory,read_inventory,read_locations,read_publications,write_publications,read_orders,read_returns';

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

(async () => {
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || await ask('Pegá tu CLIENT SECRET nuevo (empieza con shpss_): ');
  if (!clientSecret) {
    console.error('No ingresaste el client secret. Abortando.');
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/callback') {
      const code = parsedUrl.query.code;
      if (code) {
        console.log('\n¡Código recibido! Obteniendo token de Shopify...');
        try {
          const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
          });
          const data = await response.json();

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>¡Listo!</h1><p>Ya podés cerrar esta ventana y mirar la terminal.</p>');

          console.log('\n=============================================');
          console.log('TU NUEVO TOKEN DE ADMIN ES:');
          console.log(data.access_token);
          console.log('=============================================\n');
          console.log('Copialo (empieza con shpat_) y pegalo en Vercel como variable de entorno');
          console.log('SHOPIFY_ADMIN_TOKEN. NO lo pongas en el código.');
          process.exit(0);
        } catch (err) {
          console.error(err);
          res.writeHead(500);
          res.end('Error interno');
        }
      } else {
        res.writeHead(400);
        res.end('No se recibió código');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(3000, () => {
    console.log('\nServidor local iniciado.');
    console.log('1. Asegurate de tener http://localhost:3000/callback en las URLs de redirección permitidas de tu app.');
    console.log('2. Abrí este link en el navegador para autorizar:\n');
    console.log(`https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}\n`);
  });
})();
