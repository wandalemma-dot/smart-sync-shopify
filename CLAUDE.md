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

Todo sale de **un solo archivo**: la `PlantillaPedido.xlsx` de iD (ver 3.1-ter).
Su columna `Precio` es el **precio de lista (WHSL)**.

> 🟢 **LA SÁBANA SE SACÓ (20-ago-2026).** Antes había que subir un segundo Excel
> con `SKU | DESCRIPCION | WHSL PRICE | RETAIL PRICE`. Ya no: el WHSL viene en la
> plantilla y el RETAIL **se calcula** (ver abajo). `listaPrecios.ts` sigue en el
> repo y `processFiles()` todavía acepta una sábana como parámetro opcional, pero
> la app **ya no la pide**.

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

### 3.1-quater Variantes SIN ALTA en la sucursal (error clásico)

Shopify **no deja escribir stock** en una sucursal si la variante no está dada de
alta ahí. Devuelve:
`The specified inventory item is not stocked at the location.`

> 🔴 **DOS COSAS QUE HAY QUE SABER.**
> **1)** Al pedir `inventoryLevel(locationId:)` de una variante que no está dada
> de alta, Shopify devuelve **null**. Eso **NO significa "tiene cero"**: significa
> que ahí no existe. Si se interpreta como cero, se la manda a escribir y falla.
> **2)** `inventorySetQuantities` es **todo o nada**: si UNA variante del lote
> falla, Shopify rechaza **el lote entero**. Con lotes de 100, una sola variante
> mala tiraba abajo 99 escrituras buenas (a Wanda le dio «Escritos 490 · fallidos
> 400» = 4 lotes perdidos por un puñado de variantes).

Cómo quedó resuelto en `writeStock.ts`:

- `planStockWrite()` aparta esas variantes en **`sinActivar`** antes de escribir.
  Nunca entran al lote.
- `executeStockWrite()`: si igual un lote falla, **reintenta de a una**, así se
  pierde solo la que realmente tiene el problema y los contadores son reales.
- `activarEnSucursal()` las da de alta con `inventoryActivate` y les carga la
  cantidad. Es **un botón aparte con su propia confirmación** (decisión de Wanda,
  20-ago-2026): el botón rojo de stock **nunca** las toca.
  `inventoryActivate` está en la allowlist de `api/shopify.js`.

### 3.1-ter iD — «PlantillaPedido.xlsx» (formato vigente desde agosto 2026)

Es como Wanda baja hoy los archivos de iD: **uno por marca** (uno de Converse,
otro de Le Coq). Reemplaza al viejo `Stock (N).xlsx`.
Código en `src/utils/plantillaPedido.ts`.

- Hoja `Plantilla`. Fila 0 = UUIDs (se ignora). Fila 1 = encabezado.
- Los productos vienen **de a pares de filas**: la primera dice `Disponible`
  (stock por talle), la segunda dice `Cantidad` (vacía, es donde ella escribe
  el pedido) y trae el **nombre** y el **color**.
- **Trae el precio de lista**, cosa que el formato viejo no tenía.
  Confirmado por Wanda: la columna `Precio` es **el costo SIN el 7%**, o sea el
  WHSL. Verificado contra la sábana del 04-08-26: **coincide exacto en 381 de
  386** códigos en común. En los 5 que difieren, la sábana repite el mismo valor
  (53422,4599 / retail 99900) para 5 modelos distintos → la buena es la del
  archivo. Por eso `whslDelArchivo` hace que **este precio le gane a la sábana**.
- El **precio sugerido** (que necesitan los 45 básicos) **no viene en el archivo,
  se calcula**: `redondearALaCentena(lista × 1,87)` → `sugeridoId()`.
  Regla que dio Wanda el 20-ago-2026.
  ✅ Verificado contra las **14.744** filas de la sábana del 04-08-26 que tienen
  WHSL y RETAIL: da el RETAIL exacto en el **100%** (Le Coq 3.843/3.843,
  Converse 10.901/10.901, los 45 básicos 45/45). Por eso la sábana quedó de más.

> 🔴 **DOS TRAMPAS DE ESTE FORMATO — no tocar sin leer.**
> **1)** Los talles se leen **por nombre de columna**, nunca por posición: el
> encabezado va `030,035,…,130` y **recién después** `075,085,095,100,015,020,…`.
> Leer por posición = cargar el stock en el talle equivocado.
> **2)** La conversión numérica se hace **solo si el talle es todo dígitos**
> (`/^\d+$/`). `parseInt("3XL")/10` daría `0.3`.
> **3)** Las celdas que dicen **`+50`** significan «más de 50»: el proveedor no
> publica el número exacto cuando tiene mucho. **Regla de Wanda: se cargan 50.**
> En el archivo del 20-ago son **351 celdas** (121 productos). El `+` se saca a
> propósito; no se confía en que `Number("+50")` devuelva 50 solo.
> Y `-` significa que ese talle el proveedor no lo tiene: **no entra al mapa de
> talles** (ver 3.1-quinquies para qué pasa después con esos talles).

### 3.1-quinquies El talle que ya no viene → VA A CERO (28-ago-2026)

Regla de Wanda, dicha así:

> «Si yo en mi tienda tengo un talle 42 y vos en esta tabla lo ves con un guión,
> o en gris, o en blanco, lo que sea, lo tenés que poner en cero.»

**El problema que arregla.** El Excel de iD trae, por producto, **solo los talles
con stock**; el resto viene con `-`. Antes esos talles se salteaban y nunca se
tocaban: si iD se quedaba sin el 42 de un modelo, en Shopify **ese 42 seguía
disponible para la venta para siempre**. No es que se cargaba mal — es que no se
cargaba nunca.

**Qué dice el archivo, verificado.** En la `PlantillaPedido_6.xlsx` (28-ago-2026),
de 12.342 celdas de talle: **10.833 con guión, 1.167 con número, 342 con `+50`,
CERO celdas vacías y CERO ceros literales.** iD nunca escribe un 0. Además el
guión siempre viene en celda **gris** (`D3D3D3` en la fila `Cantidad`), que es
como el proveedor marca «este modelo no viene en ese talle». No hace falta leer
el color: la regla es la misma para todos los casos.

**Cómo quedó** (`planStockWrite()` en `writeStock.ts`): por cada producto que sí
está en el Excel, toda variante que en la sucursal de iD **tenga stock > 0** y que
el archivo **no cubra con un número** se agrega a `changes` con `desired: 0` y
`motivo: 'El proveedor ya no tiene este talle'`. Sale en la lista roja
**«A poner en 0»** de la pantalla y solo se escribe si Wanda confirma.

> 🔴 **DOS SALVAGUARDAS QUE NO SE TOCAN.**
> **1)** El barrido corre **solo en Converse y Le Coq**, donde el Excel es el
> catálogo COMPLETO del proveedor. Las otras marcas mandan listas **parciales**
> («cargá esto»): barrer ahí borraría stock real. Es la misma condición que ya
> usa `enPeligro` en `syncLogic.ts`.
> **2)** Si de un producto hubo **un solo talle que no se supo convertir**
> (está en la tabla de conversión pero el US no figura), ese producto **queda
> afuera del barrido**. Si no, un error de conversión pondría en 0 un talle que
> el proveedor SÍ tiene. Esos casos siguen apareciendo en «No ubicados» para
> revisión manual.
>
> 🛡 Tests: `src/utils/__tests__/talleACero.test.ts`. Si un cambio los hace
> fallar, el cambio está mal.

**Distinto de «el proveedor ya no lista el producto»** (`enPeligro`), que apaga el
producto **entero** cuando su código no aparece en el Excel. Este barrido es el
caso de al lado: el producto sigue, el talle no.
>
> Verificado contra `Stock 3.xlsx` (18-ago): de 243 códigos en común, 202 (83%)
> dan **exactamente el mismo juego de talles**; el resto difiere en uno o dos
> talles sueltos, que es movimiento de stock entre el 18 y el 20 de agosto.
> Chequeos puntuales: A10564C → costo 44.710 / precio 109.900, y 157197C →
> costo 54.656, los dos iguales a lo que ya venía mostrando la app.

### 3.1-bis VART (marca nueva — agosto 2026, todavía sin cargar nada)

Marca argentina de indumentaria y calzado. Usa la **plantilla de carga de INDY**
(la misma que Luxo): hoja `Carga Productos`, encabezado en la fila 4.
Código en `src/utils/vartLogic.ts`.

- **Precio** = columna `Precio / Markup` **tal cual**. La app NO calcula el precio.
- **Costo** = columna `Costo` menos el descuento comercial → `VART_DESCUENTO`.
  🟡 **HOY VALE 0**: Wanda todavía lo está negociando con el proveedor.
  Cuando lo cierre, se cambia **en ese único lugar**.
- **Talles: tal cual, SIN conversión.** Es marca argentina. Ropa S…XXL,
  pantalón 28…40 de cintura, calzado 35…46.
- **Sucursal**: `VART_LOCATION`. 🟡 **PENDIENTE** el nombre exacto en Shopify.
  Hasta entonces la simulación de stock avisa "no encontré la sucursal" en vez
  de escribir en el lugar equivocado. **Eso es a propósito.**
- **Agrupación**: el producto es el SKU **sin el sufijo** (`VA0082-524-63` →
  `VA0082-524`). Si se agrupara por SKU completo, cada talle sería un producto
  distinto.
- **El SKU de cada variante sale del Excel, no se inventa.** En la ropa el
  sufijo es un código (63=S, 64=M, 65=L, 66=XL, 67=XXL), **no** el talle. En el
  calzado sí es el talle. Por eso guardamos `skuPorTalle`.

> 🔴 **VALIDACIONES QUE NO SE SACAN.** La primera planilla de Vart vino con
> filas desalineadas. Como en el **calzado** el SKU siempre termina en el talle,
> se puede verificar la fila contra sí misma: si `VA0091-10-35` dice talle `44`,
> la fila está corrida y **NO se carga**. Lo mismo con SKUs repetidos.
> Preferimos dejar filas afuera y avisar, antes que meter stock en el talle
> equivocado (que es exactamente lo que pasó con Converse 157197C).
> En el archivo del 19-ago: **18 filas frenadas** (13 corridas + 5 duplicadas),
> 1573 de 1639 unidades cargadas, 50 productos limpios de 53.

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

> 🔴 **CÓMO SE DECIDE SI ES CALZADO — se pregunta AL REVÉS, a propósito.**
> `esCalzadoLeCoq()` **no** busca palabras de zapatilla. Busca palabras de lo que
> **NO** es zapatilla (`PANT`, `SOCKS`, `DRESS`, `TEE`, `BACKPACK`…, o sea
> `LECOQ_CATEGORIAS`). Si el nombre **no** cae en ninguna y el talle es numérico
> **≥ 30**, es calzado y se le resta 1.
>
> **Error real (agosto 2026, lo encontró Wanda).** Antes se detectaba el calzado
> por una lista de palabras: `RUNNING`, `SNEAKER`, `STAR`, `COURT`. Como el
> proveedor le pone **nombre de fantasía** a cada modelo, todo lo que no tuviera
> esas palabras se quedaba **sin convertir, en silencio**: `Strider`,
> `Carc Slides`, `Aa 75`, `Veloce Soft`. El stock del talle **45 se cargaba en el
> 45 en vez del 44** (y así todo el producto, corrido un talle), y las filas
> caían en **«Ya estaban bien»**, así que ni siquiera se veían como problema.
>
> Una lista de nombres de zapatilla **nunca va a estar completa**: cada temporada
> el proveedor saca modelos nuevos. La lista de lo que no es calzado sí se puede
> completar. **No volver a invertirlo.**
>
> Además es la **misma regla que ya usaban los títulos** (`lecoqCategoryWord()`
> con el talle): por eso estos productos salían titulados
> «Zapatillas Le Coq Sportif Strider» pero con el talle sin convertir.
>
> ➕ **Si aparece indumentaria con talle numérico y un nombre nuevo**, se agrega
> esa palabra a `LECOQ_CATEGORIAS`. **No** se toca `esCalzadoLeCoq()`.
>
> 🛡 Hay tests que lo cuidan: `src/utils/__tests__/talleLeCoq.test.ts`.
> **Si un cambio los hace fallar, el cambio está mal** — no se ajusta el test.
> Se corren con `npm test`.

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
archivo. Si el archivo no trae precio, se crean en **$0**.

### 3.5-bis Crear productos nuevos: se ELIGE cuál crear

La caja «Crear los nuevos directo en Shopify» y la de «Configurar Tablas para
Nuevos Productos» eran **dos paneles separados**, uno arriba y otro al final de
la página. Wanda pidió tenerlos **juntos** (20-ago-2026): cada producto muestra
su código, título, talles, unidades y su tabla de talle, todo en la misma fila.

Además cada producto tiene una **casilla**: por defecto vienen todos tildados,
pero hay cosas que no quiere publicar (cordones, medias sueltas). Los códigos
tildados se pasan a `createProducts(..., soloEstos)`; si el parámetro no viene,
se crean todos (como antes).

- «Crear 1 de prueba» crea **el primero tildado**, no el primero de la lista.
- ⚠️ El botón **📥 CSV de Nuevos (Matriz)** sigue exportando **todos**, no solo
  los tildados. Si algún día molesta, hay que pasarle el mismo filtro.

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
  listaPrecios.ts           Lee la sábana (YA NO SE USA: quedó por compatibilidad)
  __tests__/                Tests de reglas que no se pueden romper (npm test)
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
npm test              # reglas de negocio que NO se pueden romper
npx tsc --noEmit      # tipos
npx vite build        # build
```

⚠ **`npm test` no es opcional.** Ahí están escritas reglas del negocio que ya se
rompieron una vez en silencio (los talles de Le Coq). Si algo falla ahí, está mal
el cambio, no el test.

Y **probá la lógica con los archivos reales** de la carpeta de la usuaria antes de
dar algo por bueno. Varios bugs (precios en $9.900, talles corridos, 3XL→2) se
encontraron así y no se habrían visto de otra forma.
