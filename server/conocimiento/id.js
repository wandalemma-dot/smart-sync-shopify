// Proveedor iD: distribuye Converse y Le Coq Sportif.
export const PROVEEDOR_ID = `
# Proveedor iD (Converse y Le Coq Sportif)

- El stock del proveedor está en la sucursal «ID (Converse - Le Coq Sportif)». Lo vendido de esa sucursal hay que pedírselo a iD.
- Archivo de stock/precios: «PlantillaPedido.xlsx», uno por marca. Filas de a pares: «Disponible» (stock por talle) y «Cantidad»
  (donde se escribe el pedido). «+50» se carga como 50; «-» significa que el proveedor no tiene ese talle.
- La columna «Precio» es el precio de LISTA (WHSL), sin descuento.
- COSTO = lista − 10% (descuento del proveedor), con centavos.
- PRECIO de venta = lista × 2,27, redondeado a terminación …900. Excepción: los BÁSICOS (Chuck Taylor clásicas, Chuck 70,
  niño/bebé) van al sugerido = lista × 1,87 redondeado a la centena. Al básico SÍ se le actualiza el costo.
- Packs (X6, X 6, X12 en el nombre): el precio de lista es del pack completo; se divide por la cantidad para costo por par.
- Margen informativo: (precio − costo × 1,21) / precio.
- Remitos de iD: suelen venir con número 0013-xxxxxxxx; la factura con 0011-xxxxxxxx. La factura puede venir con precio
  unitario CON descuento ya aplicado (comparar contra lista − 10%) e IVA 21% aparte.
- Orden de compra de Shopify (CSV): columnas SKU, Barcode, Supplier SKU (código-talle del proveedor, ej. 157197C-070 = US 7),
  Quantity, Cost (ya con el 10% de descuento), Tax.
- Órdenes pendientes de iD: preparaciones (fulfillment orders) abiertas o en curso asignadas a la sucursal iD, cantidad pendiente
  = remainingQuantity. Solo órdenes pagadas, no canceladas, sin «pedido id» ni «solucionar».

# Costo ponderado (cuando entra mercadería a Martínez)

- Costo ponderado = (unidades en Martínez × costo actual + unidades recibidas × costo de la factura) / (unidades totales).
- Se usa SOLO el stock propio (Martínez). El stock de iD no es de INDY y no entra en el promedio.
- Si el costo actual es cero o desconocido, no inventar: avisar y proponer usar el costo de la factura.
- Shopify guarda un único costo por variante (no uno por sucursal).
`;
