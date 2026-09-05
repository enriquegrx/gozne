# Roadmap y criterios de entrega

## Fase 0 — Definición

- [x] Elegir nombre, propósito y lema.
- [x] Definir alcance inicial y límites.
- [x] Documentar arquitectura, API y amenazas.
- [ ] Validar disponibilidad jurídica y técnica del nombre Gozne.
- [ ] Elegir licencia tras revisar titularidad y dependencias.
- [ ] Aprobar las decisiones abiertas.

**Estado:** arranque y publicación del esqueleto autorizados. Nombre y licencia
siguen pendientes para la release estable.

## Fase 1 — Esqueleto público en desarrollo

- [x] Inicializar repositorio nuevo con historial independiente.
- [x] Configurar Node.js 24, TypeScript, lint, formato y tests.
- [x] Crear API mínima, SQLite y migraciones.
- [x] Añadir Dockerfile, Compose y healthcheck.
- [x] Crear CI con pruebas, auditoría y escaneo de secretos.

**Salida:** servicio mínimo construible, probado y ejecutable sin root. La
autenticación se incorporó en la fase siguiente.

## Fase 2 — Autenticación 0.1

- [x] SIWE/EIP-4361 para EOA.
- [x] Flujo Solana estandarizado y compatibilidad documentada.
- [x] Nonces atómicos y sesiones opacas.
- [x] Identidades, wallets, roles y política por aplicación.
- [x] CLI básica y forward-auth.

**Salida:** login EVM/Solana y protección de una aplicación sintética.

## Fase 3 — Seguridad y documentación

- [x] Fallos transaccionales de login, logout y política; bloqueo de SQLite.
- [x] Copia en caliente y recuperación sin reactivar sesiones antiguas.
- [x] OpenAPI, quickstart, guía de proxy y recuperación.
- [x] Inventario CycloneDX y escaneo de imagen en CI.
- [ ] Completar matriz adversarial, carga y fallos físicos de persistencia.
- [ ] Reproducibilidad binaria y firma de artefactos de release.
- [ ] Cerrar licencia y revisión de atribuciones; SECURITY y CONTRIBUTING ya
      existen.

**Estado:** endurecimiento en curso; aún no es un candidato estable.

**Salida:** candidato `0.1.0-rc.1`.

## Fase 4 — Piloto independiente

- Integrar Gozne en una aplicación independiente de los ejemplos del proyecto.
- Instalar desde cero siguiendo solo la documentación.
- Probar actualización, backup, restauración y rollback.
- Revisar compatibilidad de wallets y navegadores.

**Salida:** evidencia de portabilidad real.

## Fase 5 — Publicación 0.1.0

- Validar nombre y licencia.
- Segunda revisión de seguridad.
- Confirmar cero secretos y referencias internas.
- Publicar tag, checksums, imagen firmada y SBOM.

## Evolución posterior

Orden recomendado, condicionado por demanda real:

1. WalletConnect y experiencia móvil.
2. Vinculación y sustitución segura de varias wallets (`Gozne Link`).
3. ERC-1271/ERC-6492 para smart wallets.
4. RBAC avanzado, webhooks y observabilidad.
5. Proveedor OpenID Connect con Authorization Code + PKCE.
6. Firma múltiple para operaciones críticas (`Gozne Quorum`).
7. Firma fresca o WebAuthn para elevación (`Gozne Step-Up`).
8. PostgreSQL y alta disponibilidad si existe necesidad demostrada.

## Definición de terminado para 0.1.0

- Tests funcionales y de seguridad correctos en CI y en la imagen final.
- Cero vulnerabilidades altas o críticas.
- Instalación reproducible y documentada en menos de diez minutos.
- Backup y restauración de SQLite demostrados.
- Imagen no root y filesystem de solo lectura.
- OpenAPI y ejemplos coinciden con el comportamiento real.
- Sin secretos, datos reales ni referencias a sistemas privados.
- Limitaciones visibles y canal de seguridad disponible.
