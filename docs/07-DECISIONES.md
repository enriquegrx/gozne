# Decisiones de arquitectura

Las siguientes decisiones guían el arranque. Las selecciones técnicas de fase 1
se tomaron al iniciar la implementación el 5 de septiembre de 2026. La
publicación inicial del esqueleto fue autorizada; eso no lo convierte en una
release estable.

## D-001 — Proyecto independiente

**Aceptada.** Repositorio e historial nuevos. Las referencias privadas
permanecen fuera del proyecto público.

## D-002 — Sin custodia ni transacciones blockchain

**Aceptada.** La autenticación usará firmas de mensajes. Gozne no almacena
claves privadas ni frases semilla y no solicita transacciones blockchain.

## D-003 — Monolito modular

**Aceptada.** Una aplicación con módulos separados. No habrá un paquete de
núcleo independiente hasta que exista un segundo consumidor real.

## D-004 — Administración mediante CLI

**Aceptada como alcance.** La fase 1 incluye validación y diagnóstico. Las
operaciones sobre identidades, wallets y sesiones llegarán con la autenticación.

## D-005 — Node.js 24 y TypeScript

**Seleccionada para fase 1.** Node 24.20.0, TypeScript estricto y compilación a
ESM. TypeScript 6 se mantiene dentro del rango admitido por typescript-eslint.
Las versiones exactas están en package.json y package-lock.json.

## D-006 — SQLite

**Seleccionada para fase 1.** Adaptador pequeño sobre `node:sqlite`, con WAL,
`FULL` synchronous, timeout de bloqueo de un segundo y migraciones dentro de una
transacción `BEGIN IMMEDIATE`. Cada migración tiene checksum; se rechazan
historiales alterados o esquemas más nuevos que el ejecutable.

El API síncrono bloquea el event loop durante cada operación. Es una elección
para una sola instancia y operaciones cortas, no una solución de alta
concurrencia. Antes de una release estable se revisará el estado de soporte del
módulo integrado y el comportamiento bajo carga. El adaptador permite sustituir
el driver.

En esta fase solo existen metadatos del servicio y de migraciones. No se
anticipan tablas de usuarios o wallets sin cerrar antes los contratos de
autenticación. `/healthz` comprueba lectura de SQLite; no certifica
disponibilidad de escrituras ni que la autenticación esté implementada.

Referencia:
[documentación de SQLite en Node](https://nodejs.org/api/sqlite.html).

## D-007 — Sesiones opacas

**Seleccionada como dirección para fase 2.** Cookie aleatoria y estado de
servidor. Todavía no se emiten cookies ni se crean sesiones.

## D-008 — Política e identidades

**Pendiente para fase 2.** Definir la fuente de verdad para identidades y
wallets y la relación entre configuración declarativa, SQLite y la CLI. Una
recarga inválida deberá preservar la última política válida. El esqueleto solo
valida las variables operativas documentadas en el README.

## D-009 — Fastify

**Seleccionada para fase 1.** Fastify 5 aporta soporte TypeScript, esquemas de
validación/serialización por ruta y pruebas HTTP con `inject`. Express sigue
siendo una alternativa válida, pero requeriría ensamblar esas piezas por
separado. La decisión se basa en esos contratos y herramientas, sin promesas de
rendimiento.

Solo se instalan las dependencias utilizadas. No se confía en cabeceras de
proxy, no hay CORS abierto y las peticiones no registran cuerpos, URLs, cookies
ni IPs.

Referencias:
[esquemas](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
y [soporte LTS](https://fastify.dev/docs/latest/Reference/LTS/).

## D-010 — SIWE y Solana

**Pendiente para fase 2.** Elegir librerías y evaluar conformidad SIWE/SIWS.
También se debe definir la vinculación del desafío al contexto de login y cuándo
se consume un nonce ante errores, para cubrir tanto replay como invalidación
maliciosa del desafío de otro usuario. No se ha trasladado un codec ni un
verificador propio de otro proyecto.

## D-011 — Licencia

**Pendiente.** Apache 2.0 es una opción en estudio. El repositorio es visible,
pero todavía no concede una licencia de código abierto. `private: true` en
package.json impide una publicación accidental en npm; no controla GitHub.

## D-012 — Nombre

**Nombre de trabajo: Gozne.** Su uso en este repositorio no constituye una
comprobación de marcas. La validación del nombre queda pendiente antes de una
release estable y de su explotación comercial.
