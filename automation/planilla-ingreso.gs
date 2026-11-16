// PLANILLA «CONTROL INGRESO MERCADERIA» — recibe de la app de INDY una fila por carga y la agrega abajo.
// Se pega UNA vez en la planilla: Extensiones → Apps Script (reemplazar todo lo que haya en Código.gs).
// O, si quien lo publica no es dueña de la planilla, en un proyecto propio de script.google.com: en ese
// caso, en Configuración del proyecto → Propiedades de la secuencia de comandos, agregar PLANILLA con el
// ID de la planilla (lo que está entre /d/ y /edit en su dirección).
// Pasos completos en CLAUDE.md («Fila en la planilla de ingreso»). Este archivo NO tiene claves:
// la clave se crea con crearClave() y queda guardada en las propiedades del script.
//
// Qué hace: busca la hoja cuya fila 1 tiene FECHA, PROVEEDOR y N° FACTURA; encuentra las columnas por
// su encabezado (no por letra); agrega la fila debajo de la última con FECHA; copia el formato de la
// última fila del mismo proveedor (su color); pinta OBSERVACIONES en naranja si hubo algo para revisar.
// Si el N° de factura ya está en la planilla, no la repite. No borra ni cambia otras filas.

function crearClave() {
  var p = PropertiesService.getScriptProperties();
  var clave = p.getProperty('CLAVE');
  if (!clave) {
    clave = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    p.setProperty('CLAVE', clave);
  }
  Logger.log('Copiá esta clave en Vercel como PLANILLA_SECRETO: ' + clave);
}

function responder(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function normalizar(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
}

function libro() {
  var id = String(PropertiesService.getScriptProperties().getProperty('PLANILLA') || '').trim();
  if (id) return SpreadsheetApp.openById(id);
  var activa = SpreadsheetApp.getActiveSpreadsheet();
  if (!activa) throw new Error('Falta la propiedad PLANILLA con el ID de la planilla.');
  return activa;
}

function hoja() {
  var hojas = libro().getSheets();
  for (var i = 0; i < hojas.length; i++) {
    var h = hojas[i];
    if (h.getLastColumn() < 1) continue;
    var enc = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(normalizar);
    if (enc.indexOf('FECHA') >= 0 && enc.indexOf('PROVEEDOR') >= 0 && enc.indexOf('NFACTURA') >= 0) return h;
  }
  throw new Error('No encontré la hoja con FECHA, PROVEEDOR y N° FACTURA en la fila 1.');
}

function columnas(h) {
  var enc = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(normalizar);
  function col(pred) { for (var i = 0; i < enc.length; i++) if (pred(enc[i])) return i + 1; return 0; }
  var c = {
    fecha: col(function (e) { return e === 'FECHA'; }),
    proveedor: col(function (e) { return e === 'PROVEEDOR'; }),
    factura: col(function (e) { return e === 'NFACTURA'; }),
    remito: col(function (e) { return e === 'NREMITO'; }),
    monto: col(function (e) { return e === 'MONTO'; }),
    observaciones: col(function (e) { return e.indexOf('OBS') === 0; }),
    carga: col(function (e) { return e === 'CARGASTOCK'; }),
  };
  for (var k in c) if (!c[k]) throw new Error('No encontré la columna ' + k + ' en la fila 1.');
  return c;
}

function fecha(s) {
  var m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(s || ''));
  return m ? new Date(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1])) : s;
}

function texto(s) {
  s = String(s || '');
  return /^[=+@-]/.test(s) ? "'" + s : s;
}

function doPost(e) {
  try {
    var datos = JSON.parse(e.postData.contents);
    var clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
    if (!clave || datos.clave !== clave) return responder({ error: 'Clave incorrecta.' });
    if (datos.accion === 'probar') return responder({ ok: true, hoja: hoja().getName() });
    if (datos.accion !== 'anotar' || !datos.fila) return responder({ error: 'Pedido inválido.' });
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return responder(anotar(datos.fila));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return responder({ error: String(err && err.message || err) });
  }
}

function anotar(f) {
  var h = hoja();
  var c = columnas(h);
  var ultimaHoja = Math.max(h.getLastRow(), 1);
  var fechas = h.getRange(1, c.fecha, ultimaHoja, 1).getDisplayValues();
  var ultima = 1;
  for (var i = fechas.length - 1; i >= 1; i--) if (String(fechas[i][0]).trim()) { ultima = i + 1; break; }

  // Misma factura ya anotada: no repetir.
  if (ultima > 1) {
    var facturas = h.getRange(2, c.factura, ultima - 1, 1).getDisplayValues();
    for (var j = 0; j < facturas.length; j++) {
      if (String(facturas[j][0]).indexOf(f.numero) >= 0) return { ok: true, yaEstaba: true, fila: j + 2 };
    }
  }

  var n = ultima + 1;
  var ancho = h.getLastColumn();
  // Color del proveedor: el formato de su última fila (o del mismo grupo, «ID …»).
  var provs = ultima > 1 ? h.getRange(2, c.proveedor, ultima - 1, 1).getDisplayValues() : [];
  var modelo = 0, parecido = 0, grupo = normalizar(f.proveedor).slice(0, 2);
  for (var k = provs.length - 1; k >= 0 && !modelo; k--) {
    var p = normalizar(provs[k][0]);
    if (p === normalizar(f.proveedor)) modelo = k + 2;
    else if (!parecido && grupo && p.indexOf(grupo) === 0) parecido = k + 2;
  }
  modelo = modelo || parecido;
  if (modelo) h.getRange(modelo, 1, 1, ancho).copyTo(h.getRange(n, 1, 1, ancho), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

  h.getRange(n, c.fecha).setValue(fecha(f.fecha));
  h.getRange(n, c.proveedor).setValue(texto(f.proveedor));
  h.getRange(n, c.factura).setValue(texto(f.factura));
  h.getRange(n, c.remito).setValue(texto(f.remito));
  if (f.monto !== null && f.monto !== undefined) h.getRange(n, c.monto).setValue(Number(f.monto));
  h.getRange(n, c.observaciones).setValue(texto(f.observaciones));
  h.getRange(n, c.carga).setValue(fecha(f.carga));
  var obs = h.getRange(n, c.observaciones);
  if (f.ok) { if (modelo) obs.setBackground(h.getRange(modelo, c.proveedor).getBackground()); }
  else obs.setBackground('#ff6d01');
  return { ok: true, fila: n };
}
