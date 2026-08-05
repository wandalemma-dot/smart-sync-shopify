// Utilidades compartidas para generar y descargar CSV.
// Antes estaban duplicadas en syncLogic.ts y restockLogic.ts.

// Escapa un valor para que sea seguro dentro de un CSV
// (comillas, comas y saltos de línea).
export function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Dispara la descarga de un archivo CSV en el navegador.
// El prefijo ﻿ (BOM) hace que Excel abra los acentos correctamente.
export function triggerDownload(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Fecha de hoy en formato YYYY-MM-DD para nombrar los archivos.
export function todayStamp(): string {
  return new Date().toISOString().split('T')[0];
}
