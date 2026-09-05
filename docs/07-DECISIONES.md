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

**Implementada.** Configuración, diagnóstico, política, identidades, wallets,
sesiones y auditoría se administran localmente por CLI.

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

El esquema 2 añade política efectiva, nonces, sesiones y auditoría. `/healthz`
comprueba lectura, no disponibilidad de escrituras.

Referencia:
[documentación de SQLite en Node](https://nodejs.org/api/sqlite.html).

## D-007 — Sesiones opacas

**Implementada.** Cookies aleatorias de 256 bits; SQLite almacena su hash.
Sesiones de una hora, con revocación y comprobación de política viva.

## D-008 — Política e identidades

**Implementada.** SQLite es la fuente de verdad. Importación JSON completa,
atómica y validada; las ediciones CLI usan control de concurrencia optimista. Un
cambio efectivo revoca todas las sesiones y desafíos. Una importación idéntica
no modifica nada. No hay recarga automática desde archivos.

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

**Implementada.** `siwe` y recuperación EOA con `ethers`; Wallet Standard para
el formato SIWS y `@noble/curves` para Ed25519 estricto. No se admiten smart
wallets ni firmas de mensajes libres. El mensaje debe coincidir exactamente con
el emitido, incluyendo origen, cadena, nonce, tiempos y recurso de aplicación.

El desafío está ligado a una cookie aleatoria de contexto. Una firma inválida
consume el nonce solo cuando coincide ese contexto; otro navegador no puede
quemarlo. Verificación final, consumo y creación de sesión se confirman en una
transacción. Un fallo de persistencia no emite una cookie de sesión.

Referencias: [SIWE](https://docs.login.xyz/),
[Sign-In With Solana](https://github.com/phantom/sign-in-with-solana).

## D-011 — Licencia

**Pendiente.** Apache 2.0 es una opción en estudio. El repositorio es visible,
pero todavía no concede una licencia de código abierto. `private: true` en
package.json impide una publicación accidental en npm; no controla GitHub.

## D-012 — Nombre

**Nombre de trabajo: Gozne.** Su uso en este repositorio no constituye una
comprobación de marcas. La validación del nombre queda pendiente antes de una
release estable y de su explotación comercial.
