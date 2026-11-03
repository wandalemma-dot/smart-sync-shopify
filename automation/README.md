# Stock ID

El flujo de Converse usa `preview.ts` para descargar y simular, `apply-id.mjs` para
aplicar cantidades y crear talles habilitados, y `verify-id.ts` para volver a
comparar Shopify con el mismo Excel. El paso de escritura presenta el token de
lectura y una identidad OIDC temporal de la ejecución privada. La app web usa
su sesión y la confirmación del operador para las mismas dos operaciones.

## Referencia histórica de la primera fase de simulación

Esta implementación todavía necesita configurar secretos, desplegar la protección y validar una ejecución en la nube. No activar el horario antes de esa prueba. El código no contiene un camino de aprobación ni de escritura.

## Qué cambia en la app

- `/api/shopify` exige sesión de usuario o un token separado de automatización. Rechaza antes de pedir el token de Shopify.
- Todas las mutaciones están bloqueadas, también para usuarios autenticados. No hay variable ni parámetro para habilitarlas. Los botones antiguos no pueden eludir el servidor.
- El bot solo puede consultar `shop`, `locations` y `products`. No puede consultar pedidos ni clientes.
- Se valida GraphQL con un parser, sin permitir varias operaciones, mutaciones, suscripciones ni mezclas. La cookie es Secure, HttpOnly y SameSite=Strict; las solicitudes con cookie requieren el origen autorizado.
- Las claves no se guardan en localStorage ni en el código del navegador. Los errores del servidor no devuelven credenciales.

## Configuración de Vercel

Proyecto existente: `wandalemma-1284s-projects/smart-sync-shopify`.

En Settings → Environment Variables, usar tipo **Secret** para:

| Nombre | Uso |
| --- | --- |
| `APP_ACCESS_KEY` | Clave aleatoria de al menos 32 caracteres, guardada también en el gestor de contraseñas de la propietaria. Se ingresa directamente en el panel de Vercel y en el formulario de acceso de la app. |
| `AUTOMATION_READ_TOKEN` | Otra clave aleatoria independiente de al menos 32 caracteres, compartida únicamente con el ejecutor privado de GitHub Actions. |
| `SHOPIFY_ADMIN_TOKEN` | Credencial existente. Conservarla; no copiarla al bot ni al navegador. |

`APP_ORIGIN` es configuración no secreta: `https://smart-sync-shopify.vercel.app` (también es el valor por defecto). En un entorno Preview, definir la URL exacta si se quiere probar ingreso humano allí. No compartir secretos de producción con previews de código sin revisar.

Los secretos se ingresan directamente en los paneles o mediante un gestor de secretos; nunca por chat, commits, argumentos de terminal, capturas, logs ni archivos de resultados. Guardar variables y desplegar/redeployar la versión revisada. Una instalación sin secretos falla cerrada.

### Verificación antes de activar

1. Una consulta mínima anónima a `/api/shopify` debe devolver **401**. La misma consulta con token de bot válido debe responder con el dominio `indy-com-ar.myshopify.com`.
2. Las pruebas locales prueban que mutaciones y consultas de pedidos no generan ninguna llamada a Shopify. No ejecutar una mutación real contra producción como prueba.
3. La app debe pedir clave y mostrar el aviso de modo de revisión. Verificar ingreso/cierre de sesión desde HTTPS.
4. Revisar también dominios de Preview y despliegues antiguos que conservan código anterior. La protección de la versión nueva no borra automáticamente los despliegues anteriores. Restringir su acceso en Vercel o retirar los que sigan expuestos, y revisar registros/alcance de la credencial anterior antes de permitir escrituras futuras.

## Ejecutor con la PC apagada

Usar un repositorio **privado** dedicado a la automatización. El repositorio de la app es público; no publicar allí Excel, simulaciones, sesiones ni datos comerciales. El workflow se niega a ejecutar si el repositorio no es privado.

1. Copiar `cloud-workflow.yml.example` a `.github/workflows/stock-preview.yml` en el repositorio privado.
2. En Settings → Secrets and variables → Actions → Secrets, guardar directamente:
   - `ID_USERNAME`: correo de la cuenta corporativa de ID.
   - `ID_PASSWORD`: contraseña de ID.
   - `AUTOMATION_READ_TOKEN`: el mismo secreto del bot guardado en Vercel, distinto de la clave humana.
3. En Variables, guardar `STOCK_SOURCE_COMMIT` con el SHA completo de 40 caracteres del código revisado/desplegado. Nunca usar `main` como sustituto: el job que recibe secretos debe ejecutar una revisión fija.
4. Mantener `STOCK_BRANDS=converse` para la prueba actual. Le Coq se omite a pedido del usuario. Cambiar a `converse,lecoq` solo cuando se decida incluirlo.
5. Ejecutar primero **Run workflow**. Confirmar que el inicio de sesión desde GitHub, los selectores, la descarga y el análisis funcionan. Los selectores se obtuvieron del portal actual, pero aún requieren la prueba desde el ejecutor remoto. Si cambian o el login falla, el job se detiene; no intenta eludir controles.
6. Revisar el artifact privado `stock-simulation-<run id>`: HTML legible y JSON completo con cantidades, SKU, inventario/sucursal, exclusiones y huella del Excel. Retención: 7 días. No contiene claves ni sesiones.
7. Solo después de la primera prueba correcta, guardar la variable `STOCK_AUTOMATION_ENABLED=true` para activar los horarios.

Horario confirmado: **08:00, 12:00, 16:00 y 20:00, America/Buenos_Aires**. El workflow usa UTC equivalente 11:00, 15:00, 19:00 y 23:00. GitHub puede retrasar ejecuciones programadas; no es un servicio de tiempo real. Revisar los minutos disponibles del plan privado antes de habilitar recurrencia; no contratar ni ampliar presupuesto automáticamente.

El navegador del bot es nuevo y se cierra al terminar. No guarda cookies, perfiles ni trazas. Selecciona marca, ELEVE SAS (2059), canal DISPONIBLE y descarga el Excel. No completa cantidades ni pulsa Enviar pedido. Exige la hoja Plantilla y datos no vacíos antes de calcular. Reutiliza `processFiles()` y `planStockWrite()`; respeta talles, sucursal ID, Martínez y NO SINCRONIZAR. Solo exporta simulaciones; no importa ni llama funciones de escritura.

## Aprobación futura

Esta fase no aplica cambios aunque alguien pulse un botón antiguo. Para incorporar escritura habrá que construir una operación separada que valide del lado del servidor la aprobación del plan exacto, su antigüedad, sucursal, variantes, cantidades previas, exclusiones e idempotencia. Releer stock antes de aplicar; si cambió, volver a simular y solicitar una aprobación nueva. No habilitar nuevamente un proxy de mutaciones genéricas.

## Verificación local

`npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.app.json --noEmit`, `npx vite build`.

El test opcional de Crocs ahora usa `CROCS_TEMPLATE` en lugar de leer incidentalmente un archivo de Downloads de una computadora específica. No se cambió el parser de Crocs: el archivo local encontrado tenía una fila inválida y sigue siendo rechazado. Se corrigieron además dos errores preexistentes de tipos (parámetro sin uso y tipos del fixture de ventas). No se modificaron reglas de negocio de sincronización.

Referencias: [Secrets de Vercel](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [Secrets de GitHub Actions](https://docs.github.com/en/actions/concepts/security/secrets), [horarios de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
