# Guía del proyecto — Sincronización de Stock e Inventario (INDY)

> **Leé esto ANTES de tocar código.** Acá están las reglas de negocio reales de
> la tienda. Varias no son deducibles del código a simple vista, y ya se
> rompieron una vez por agregar funcionalidad nueva sin arrastrarlas.
>
> **Regla de oro:** cuando agregues un camino nuevo (una consulta, una escritura,
> una pantalla), revisá si alguna regla de abajo tiene que aplicarse ahí también.

La dueña del negocio es **Wanda** (tienda INDY, `indy-com-ar.myshopify.com`).
No es programadora: explicale en castellano simple, sin jerga.

---

## 1. Qué hace la app

App web (React + Vite, deploy automático en Vercel desde `main`) con dos pestañas:

| Pestaña | Para qué sirve |
|---|---|
| **Sincronización** | Subís el archivo del proveedor → compara contra Shopify → actualiza stock, precios y crea productos nuevos. |
| **Reposición** | Arma el pedido diario que Wanda le hace al proveedor (traer de iD a Martínez). **Solo lectura.** |

La app **lee Shopify en vivo**: no hace falta subir el CSV de productos.

---

## 2. Cómo funciona el negocio (contexto imprescindible)

Hay **dos depósitos** en Shopify y significan cosas distintas:

- **`DEPOSITO MARTINEZ`** → depósito **propio**. Lo que Wanda tiene físicamente.
- **`ID (Converse - Le Coq Sportif)`** → stock del **proveedor**. Figura publicado
  en la tienda pero **no está en su poder**: si se vende, hay que pedírselo.

El pedido diario consiste en **traer de iD a Martínez** lo que se vende bien,
para no quedarse sin stock (tarda ~2 días). Ese pedido se carga a mano en una
web externa del proveedor — la app **no** la completa (por ahora solo muestra la lista).

### Sucursal de stock por marca

```
converse → ID (Converse - Le Coq Sportif)
lecoq    → ID (Converse - Le Coq Sportif)
orchard  → ORCHARD
bloque   → BLOQUE DISTRIBUTION
luxo     → LUXO
```

---

## 3. Reglas de negocio por marca

### 3.1 Converse y Le Coq ("iD") — PRECIOS

Los precios salen de la **sábana** del proveedor (Excel con hojas *Le Coq Sportif*
y *Converse*, columnas `SKU | DESCRIPCION | WHSL PRICE | RETAIL PRICE`).
Se sube en la pestaña Sincronización. **El Excel de stock NO trae precios**: sin
la sábana, los productos nuevos se crean en $0.

- **Costo** = `WHSL PRICE − 7%` (descuento general del proveedor) → `costoId()`
- **Precio** = `WHSL PRICE × 2.27`, redondeado a terminación **…900** → `precioId()`
  - Ese markup da ~**50% de margen** (el sugerido del proveedor da solo 39,8%).
- **EXCEPCIÓN — productos BÁSICOS**: van **SIEMPRE** al `RETAIL PRICE` (sugerido
  del proveedor), **nunca** con markup. Lista en `src/utils/conversePreciosFijos.ts`.
  Son las Chuck Taylor clásicas (Core/Hi/Ox/Leather/Platform), Chuck 70 y niño/bebé.
  **No se negocia**: son precios impuestos.
  - ⚠️ **Al básico SÍ se le actualiza el COSTO** (confirmado por Wanda, 18-ago-2026).
    Lo único que queda clavado es el **precio de venta**. Por eso, cuando el
    proveedor aumenta, el margen del básico baja: es esperado, no es un bug.
  - En el archivo real de agosto, los básicos son solo **295 de 1131 filas (26%)**.
    Si parece que "la app solo toca los básicos", casi seguro es un problema de
    orden en la lista, no de cálculo: cada Chuck Taylor trae 10-12 talles seguidos.
    Por eso `actualizacionesAplicables()` ordena **primero las que cambian el
    precio de venta** y después las de solo costo.

### 3.2 Converse — TALLES (lo más delicado del sistema)

El proveedor manda talles **US**; en Shopify están en **ARG**.

> ⚠ **Un mismo talle AR NO equivale siempre al mismo US.** Depende de la **curva**
> del modelo: AR 40 = US 8 (curva 2), US 7 (curva 8), US 9 (curva 8A).
> **Es obligatorio conocer el código del producto para convertir.**
> Si alguien lo simplifica a una tabla única, **los pedidos salen mal en silencio**.

- Motor: `src/utils/conversorTalles.ts` + `tallesConverseLecoq.json`
  (7 curvas + 659 códigos → curva). Verificado: 140/140 conversiones reversibles.
- **Nunca adivina**: si el código no está o el talle cae fuera de la curva,
  devuelve `ok: false` con el motivo. Esas filas **se muestran** en la UI para
  revisión manual, **nunca se descartan en silencio**.
- Los productos en Shopify llevan **dos etiquetas**: el **código** (`A15621C`) y la
  **tabla de talle** (`TABLA DE TALLE CONVERSE 1`). Al crear productos nuevos hay
  que ponerle **las dos**.

> 🔴 **CÓMO SE ELIGE LA TABLA — leer sí o sí.** Orden de prioridad (`converseTablaDe()`):
> **1)** el **maestro de curvas por código** (`converseCurvas.ts`) — dato oficial del
> proveedor; **2)** si el código no está, **solo** la etiqueta que empieza con
> `TABLA DE TALLE`; **3)** si tampoco, Tabla 1.
>
> **NUNCA buscar palabras sueltas ("mujer", "niño") en todas las etiquetas.**
> Error real de agosto 2026: los productos tienen etiquetas de marketing
> (`converse mujer`, `zapatillas para niña`, `zapatillas urbanas mujer`) que pisaban
> la etiqueta real. El código `157197C` tenía `TABLA DE TALLE CONVERSE 2` pero se le
> aplicaba la de MUJER: **142 pares de US 6 iban al talle 36.5 en vez del 39**, y así
> con todo el producto. No hay validación posterior que lo detecte.
>
> Además, el maestro **corrige** casos donde Shopify está mal cargado: hay productos
> sin etiqueta de tabla, y otros con **dos etiquetas contradictorias** (BEBE y NIÑO
> a la vez). Por eso el maestro tiene que ir primero.

### 3.3 Le Coq — TALLES

- **Calzado**: el talle de Shopify es **UNO MENOS** que el del Excel
  (Excel 040 → Shopify 39). Función: `talleShopifyLeCoq()`.
- ⚠ **Solo al calzado.** Hay otros talles numéricos que **NO** se tocan:
  pantalones (38), medias (1, 2), vestidos (039). Por eso la función necesita el
  **nombre del producto** para decidir.
- Indumentaria (S, M, L, XL, 3XL, TU): va **tal cual**, sin conversión.

### 3.4 Le Coq — TÍTULOS

El proveedor manda los nombres en inglés/francés. En la tienda van como
**`{Categoría} Le Coq Sportif {Nombre}`**. Mapeo en `lecoqCategoryWord()`:

```
SOCKS → Medias      NECK → Cuello        POLO → Chomba
MAILLOT → Camiseta  TEE → Remera         DÉBARDEUR → Musculosa
SHORT → Short       PANT/CHINO → Pantalón  PARKA → Parka
JACKET/DOUDOUNE → Campera   SWEAT → Buzo   DRESS → Vestido
BACKPACK → Mochila  RUNNING/STAR → Zapatillas
```

### 3.5 Converse — productos nuevos

Al crear, cada producto se clasifica (`autoConverseTable()`):
`0` = Accesorio (sin talle) · `-1` = Indumentaria (talle tal cual) ·
`1..5` = Zapatilla (aplica tabla US→ARG). Se pre-selecciona por el maestro de
curvas y se puede cambiar a mano en pantalla.

Se crean **Activos**, publicados **solo en Point of Sale**, con el stock del
archivo. Si no hay precio (Converse/Le Coq sin sábana) se crean en **$0**.

### 3.6 Orchard

- Match **por NOMBRE** (no por SKU ni tags): el título de Shopify es
  `{Tipo} Orchard {Nombre}`. Se canonizan colores EN↔ES (Black↔Negro).
- Precio: usa el **PÚBLICO** del proveedor tal cual. Costo: neto **−20%**.

### 3.7 Bloque (Protec, Skate World, Zoo York…)

- Acepta **PDF** (presupuesto/factura) **y Excel**. Un solo archivo: no pide remito.
- El PDF trae todo en una línea: `SKU NOMBRE... COLOR TALLE CANT PRECIO [%DES] MONTO`.
  ⚠ **El talle puede ser numérico** (tablas de skate: 8.25, 8.125). Por eso el
  parser **no cuenta posiciones**: identifica las columnas verificando que
  `cantidad × precio = monto`. Si se rompe eso, lee mal los precios.
- Lee **todas las marcas** del proveedor (PADPRO, SKAWI, TABZY…), no solo las "SK".
- Precio = costo de lista **× 2 exacto** (⚠ **sin** terminación 9900).
  Costo = lista **−15%** (salvo que el PDF traiga un % explícito, ahí se usa ese).
- Categorías por nombre (`bloqueCategoryWord()`): PAD→Protecciones, KNEE→Rodilleras,
  WRIST→Muñequeras, HIP/CULERA→Protectores de cadera, HELMET→Casco, KEYCHAIN→Llavero.

### 3.8 Productos que el proveedor ya no lista

Si un producto está publicado **con stock del proveedor** pero **no aparece** en el
Excel que mandó, es que ya no lo tiene → se le pone el **stock en 0** (no se borra).
Aparece en rojo en el Simular con el motivo.

> ⚠ **SOLO para Converse y Le Coq.** Ahí el Excel es el catálogo **completo**.
> Las otras marcas mandan listas **parciales** ("cargá esto"), y poner en 0 lo que
> no figura borraría stock bueno.

---

## 4. Pestaña Reposición (pedido a iD)

Solo lectura. No escribe en Shopify ni carga la web externa.

- Wanda elige **desde qué fecha** contar las ventas (la del último pedido).
- Puede subir el **Excel del pedido ya hecho** (matriz: código + columnas de talle,
  los numéricos son **US × 10**: `055` = US 5.5). Se muestra como "🚚 En camino".
- La tabla agrupa **todos los talles del mismo producto juntos**, separados por una
  línea gruesa. Wanda pide mirando el producto entero de una sola vez.
- **Ventas SIN PREPARAR** (fulfillment order abierta): van **siempre** a la lista
  principal y primeras, aunque el producto no se trabaje en Martínez — son ventas
  ya hechas que hay que entregar sí o sí.
- Productos con **todas** las variantes en 0 en Martínez → sección aparte
  **"Posibles entregas"** (no los repone; los ve por si quiere empezar a trabajarlos).
- Lo que **iD no tiene** no se muestra: no se puede pedir.

---

## 5. Seguridad (no aflojar acá)

- El token de Shopify **NO** va en el código. `api/shopify.js` lo obtiene con
  **client credentials** (`SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` en Vercel)
  y lo renueva cada 24 h. Hay fallback a `SHOPIFY_ADMIN_TOKEN`.
- El endpoint `/api/shopify` es **público** (la app no tiene login), así que tiene
  una **lista blanca**: deja pasar lecturas y **solo estas** escrituras:
  `inventorySetQuantities`, `productSet`, `publishablePublish`,
  `productVariantsBulkUpdate`. **No agregues mutaciones sin pensarlo.**
- Antecedente: hubo un token y un client secret hardcodeados en el repo público.
  Se rotaron. **Nunca vuelvas a poner un secreto en el código.**

---

## 6. Trampas conocidas (nos mordieron)

1. **Importar CSV con "Sobrescribir productos" BORRA lo que no venga en el archivo**
   (fotos, descripción, categoría, canales de venta). Por eso los precios se
   actualizan **por API** (`productVariantsBulkUpdate`), que toca solo lo indicado.
   El botón de CSV avisa antes de descargar.
2. **Formato del CSV de precios: FIJO.** Es el `products_export` de Shopify
   (`Handle, Title, Option1 Name, Option1 Value, Variant SKU, Variant Price, Cost per item`).
   Shopify **exige el Title**. Es igual para **todas** las marcas. No cambiarlo
   salvo que Shopify cambie el suyo.
3. **Límite de costo de las consultas GraphQL: 1000.** El costo se multiplica por
   cada nivel anidado. La consulta de órdenes trae de a **5** por eso.
4. **El navegador cachea fuerte** (la app se compila a un solo archivo). Después de
   deployar hay que refrescar con **Ctrl+Shift+R**, si no se ve la versión vieja.
5. **Un talle numérico no siempre es calzado** (ver 3.3 y 3.7).

---

## 7. Pendientes

- **Deprecación de Shopify (vence 1-ene-2027):** `ignoreCompareQuantity` se elimina
  en la API 2026-04. Hoy la app usa **2024-04** y ese campo en `writeStock.ts`.
  Hay que subir la versión de API y adaptarlo antes de esa fecha.
- Que la app **recuerde** el último pedido subido en Reposición (hoy se sube cada vez).
- Envío del resultado por **Telegram** (idea original, nunca implementado).

---

## 8. Mapa de archivos

```
api/shopify.js              Proxy a Shopify: token + lista blanca de mutaciones
src/App.tsx                 Pestañas y toda la UI de Sincronización
src/Reposicion.tsx          UI de la pestaña Reposición
src/utils/
  syncLogic.ts              Núcleo: lee archivos, matchea, precios, talles, CSVs
  conversorTalles.ts        Motor de conversión de talles (NO simplificar)
  tallesConverseLecoq.json  7 curvas + 659 códigos → curva
  converseCurvas.ts         Maestro código → tabla de talle
  conversePreciosFijos.ts   Los 45 básicos que van al precio sugerido
  listaPrecios.ts           Lee la sábana de precios del proveedor
  reposicionLogic.ts        Arma el pedido (ventas, stock, no preparados)
  pedidoPendiente.ts        Lee el Excel del pedido ya hecho ("en camino")
  writeStock.ts             Escribe stock (simular → confirmar)
  updatePrices.ts           Escribe precios y costos por API
  createProducts.ts         Crea productos nuevos
  shopify.ts / csv.ts       Utilidades compartidas
  restockLogic.ts           (viejo, ya no se usa desde la UI)
```

## 9. Cómo verificar antes de deployar

```bash
npm install
npx tsc --noEmit      # tipos
npx vite build        # build
```

Y **probá la lógica con los archivos reales** de la carpeta de la usuaria antes de
dar algo por bueno. Varios bugs (precios en $9.900, talles corridos, 3XL→2) se
encontraron así y no se habrían visto de otra forma.
