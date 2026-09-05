# Modelo de amenazas y seguridad

## Activos protegidos

- Acceso a aplicaciones privadas.
- Asociación entre identidad, wallet y roles.
- Sesiones activas y capacidad de revocación.
- Política de autorización.
- Registro de auditoría.
- Secretos operativos y claves de firma, si llegaran a existir.

Gozne no protege fondos ni custodia claves de wallet. Una wallet comprometida sí
permite suplantar al usuario hasta que se deshabilite o sustituya.

## Amenazas principales

| Amenaza                        | Control mínimo                                                       |
| ------------------------------ | -------------------------------------------------------------------- |
| Replay de una firma            | Nonce único, TTL corto y consumo atómico                             |
| Firma válida para otro dominio | Dominio, URI, origen y aplicación ligados al mensaje                 |
| Mensaje alterado               | Igualdad exacta con el mensaje emitido                               |
| Enumeración de wallets         | Errores públicos uniformes                                           |
| Robo de sesión                 | Cookie host-only, Secure, HttpOnly, rotación y TTL                   |
| CSRF                           | SameSite, validación de Origin/Fetch Metadata y token cuando proceda |
| Cabeceras proxy falsificadas   | Lista de proxies confiables y limpieza en el borde                   |
| Escalada de rol                | Política viva y autorización server-side                             |
| Persistencia fallida           | Fallo cerrado; nunca comunicar éxito sin escritura confirmada        |
| Abuso de nonce/API             | Límites por IP, contexto de navegador y almacenamiento global        |
| Inyección/XSS en login         | CSP estricta, sin HTML inseguro y dependencias locales revisadas     |
| Fuga en logs                   | Minimización, redacción y retención configurable                     |

## Requisitos no negociables para 0.1.0

- SIWE validado completamente, no solo un mensaje parecido a SIWE.
- Nonces con entropía mínima de 128 bits, caducidad y límite de almacenamiento.
- Consumo del nonce ante éxito o firma inválida con el contexto de navegador
  correcto; un contexto ajeno no lo consume.
- Sesiones opacas, revocables y persistentes.
- Operaciones mutadoras solo mediante métodos apropiados; nunca logout por GET.
- Comparación canónica de direcciones EVM y preservación exacta de Solana.
- Administración deshabilitada por defecto y separada del plano público.
- Proceso no root, `no-new-privileges`, capacidades eliminadas y filesystem de
  solo lectura salvo datos explícitos.
- Secretos mediante ficheros montados o mecanismos equivalentes; nunca dentro de
  imagen, repositorio, Compose o argumentos del proceso.
- Cero vulnerabilidades altas o críticas en una release.

## Pruebas de seguridad mínimas

- nonce reutilizado, caducado, desconocido y concurrente;
- firma alterada, wallet distinta, cadena distinta y dominio incorrecto;
- manipulación de `issuedAt`, expiración, URI y aplicación;
- cookie ausente, fijada, revocada, expirada o copiada a otro contexto;
- CSRF, CORS, Fetch Metadata y métodos HTTP inesperados;
- spoofing de `X-Forwarded-For`, `Forwarded` y `X-Gozne-*`;
- payload grande, JSON malformado, path traversal y XSS;
- fallo de disco, base de datos bloqueada y migración incompleta;
- reinicio durante emisión, verificación y revocación;
- permisos y usuario efectivo dentro de la imagen final.

## Publicación responsable

Antes de hacer público el repositorio existirán `SECURITY.md`, dirección privada
de reporte, versiones soportadas y plazo de respuesta. La ausencia de auditoría
externa se declarará expresamente; una suite propia no equivale a una auditoría
criptográfica independiente.
