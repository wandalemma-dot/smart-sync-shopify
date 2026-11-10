export const CONVERSE = `
# Converse

- Vendor en Shopify: «Converse». Código de modelo tipo A12975C / 157197C, va en las etiquetas y al inicio del SKU.
- TALLES: el proveedor usa US (en el Supplier SKU «-070» = US 7, «-055» = US 5.5, o sea US × 10). Shopify usa AR.
- La equivalencia US → AR depende de la CURVA del modelo: el mismo AR no es siempre el mismo US
  (AR 40 = US 8 en Tabla 2, US 7 en Tabla Mujer…). Manda la etiqueta «TABLA DE TALLE CONVERSE …» del producto;
  si no tiene, el maestro de curvas por código. Sin ninguna de las dos: NO convertir, marcar para revisión.
- Tablas: CONVERSE 1, CONVERSE 2, MUJER, MUJER 2 (curva 7), NIÑO, BEBE. Ropa (S…XXL) y accesorios no se convierten.
- Para comparar documentos de iD contra Shopify, usá el código + talle US del proveedor tal cual viene en los documentos.
  Si hay que pasar a talle AR, decí qué tabla usaste (la herramienta de producto devuelve las etiquetas).
`;
