# AGENTS.md

## Objetivo

Mantener el chatbot estable. Priorizar cambios pequeños, seguros y fáciles de revisar.

## Reglas generales

- No hacer commit.
- No crear migraciones salvo que se solicite.
- No modificar mensajes al usuario salvo que se solicite.
- No cambiar comportamiento funcional sin autorización.
- Mantener compatibilidad con producción.
- Preferir cambios pequeños y localizados.
- Evitar refactorizaciones grandes.

## Estilo de implementación

- Reutilizar funciones existentes.
- Evitar duplicar lógica.
- Si un cambio supera aproximadamente 150 líneas, dividirlo en fases.
- No mezclar varias mejoras distintas en una sola implementación.

## Validaciones

Después de modificar JavaScript:

node --check server.js

Después de modificar db.js:

node --check db.js

## Reporte esperado

Siempre indicar:

- Archivos modificados.
- Resumen de cambios.
- Validaciones ejecutadas.
- Riesgos encontrados.