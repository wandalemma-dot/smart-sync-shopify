# Sincronización de Stock e Inventario — INDY

App de la tienda **INDY** (Shopify) para sincronizar stock, precios y productos
con los archivos que mandan los proveedores, y para armar el pedido diario de
reposición.

🔗 **En vivo:** https://smart-sync-shopify.vercel.app

---

## 📖 ¿Vas a modificar el código? Leé primero [CLAUDE.md](./CLAUDE.md)

Ahí está **todo lo que hay que saber**: cómo funciona el negocio, las reglas de
precios y talles de cada marca, las trampas conocidas y lo que no hay que romper.

No es documentación opcional: varias reglas no se deducen del código y ya se
rompieron una vez por no conocerlas.

---

## Qué hace

**Pestaña Sincronización** — subís el archivo del proveedor y la app compara
contra Shopify (que lee en vivo):

- Actualiza **stock** (simular → confirmar → escribir)
- Actualiza **precios y costos** por API (sin riesgo de borrar fotos ni descripciones)
- Crea los **productos nuevos** que faltan
- Avisa de diferencias y de lo que no pudo interpretar

**Pestaña Reposición** — arma el pedido diario al proveedor (traer de iD a
Martínez), con ventas, stock de las dos sucursales, conversión de talles y lo que
ya viene en camino. **Solo lectura.**

## Marcas soportadas

Converse · Le Coq Sportif · Orchard · Luxo · Bloque (Protec, Skate World, Zoo York…)

Cada una tiene sus propias reglas de precio, talle y formato de archivo:
ver [CLAUDE.md](./CLAUDE.md).

## Desarrollo

```bash
npm install
npm run dev           # local
npx tsc --noEmit      # chequeo de tipos
npx vite build        # build de producción
```

El deploy es automático: cada push a `main` publica en Vercel.

## Configuración

Variables de entorno en Vercel (nunca en el código):

| Variable | Para qué |
|---|---|
| `SHOPIFY_CLIENT_ID` | Credenciales de la app de Shopify (token automático, 24 h) |
| `SHOPIFY_CLIENT_SECRET` | ídem |
| `SHOPIFY_ADMIN_TOKEN` | Fallback si no están las dos de arriba |
