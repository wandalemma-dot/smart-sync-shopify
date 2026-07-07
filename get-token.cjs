const http = require('http');
const url = require('url');

const clientId = '52788b0204c81f321e0c23c959793921';
const clientSecret = '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';
const shop = 'indy-com-ar.myshopify.com';
const redirectUri = 'http://localhost:3000/callback';
const scopes = 'write_products,read_products,write_inventory,read_inventory,read_locations,read_publications,write_publications';

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
                    body: JSON.stringify({
                        client_id: clientId,
                        client_secret: clientSecret,
                        code: code
                    })
                });
                
                const data = await response.json();
                
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<h1>¡Exito!</h1><p>Ya podes cerrar esta ventana. Mira la terminal para ver tu Token.</p>`);
                
                console.log('\n=============================================');
                console.log('TU NUEVO TOKEN ES:');
                console.log(data.access_token);
                console.log('=============================================\n');
                console.log('Copiá ese código que empieza con shpat_ y pasáselo a Antigravity en el chat.');
                
                process.exit(0);
            } catch (err) {
                console.error(err);
                res.writeHead(500);
                res.end('Error interno');
            }
        } else {
            res.writeHead(400);
            res.end('No se recibio codigo');
        }
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(3000, () => {
    console.log('Servidor local iniciado.');
    console.log('\n1. ASEGURATE de haber agregado http://localhost:3000/callback en tu Shopify Partner Dashboard en URLs de Redireccionamiento permitidas.');
    console.log('\n2. Hace clic en este link para autorizar:');
    console.log(`https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}\n`);
});
