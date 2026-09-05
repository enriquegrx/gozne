# API y contratos de integración

Este documento describe la API prevista para la autenticación de fase 2. El
contrato implementado en fase 1 está en [openapi.yaml](../openapi.yaml):
`/healthz`, `/version` y `/v1/auth/validate`, que siempre responde `503`. El
resto de rutas todavía no está implementado.

## API pública mínima

| Método | Ruta                | Función                  | Autenticación |
| ------ | ------------------- | ------------------------ | ------------- |
| `GET`  | `/healthz`          | Salud técnica mínima     | No            |
| `GET`  | `/version`          | Versión y build          | No            |
| `POST` | `/v1/auth/nonce`    | Crear desafío            | No            |
| `POST` | `/v1/auth/verify`   | Verificar y crear sesión | Firma         |
| `GET`  | `/v1/auth/me`       | Identidad actual         | Sesión        |
| `GET`  | `/v1/auth/validate` | Decisión para el proxy   | Sesión        |
| `POST` | `/v1/auth/logout`   | Revocar sesión actual    | Sesión + CSRF |

Se prefieren rutas versionadas desde el principio. Los endpoints administrativos
no compartirán exposición pública por defecto.

## Flujo de autenticación

1. El cliente solicita un nonce indicando aplicación y red.
2. Gozne valida origen y aplicación, genera al menos 128 bits aleatorios y
   construye el mensaje exacto.
3. La wallet muestra y firma ese mensaje.
4. El cliente envía firma, mensaje y metadatos estrictamente necesarios.
5. Gozne compara el mensaje emitido, valida firma, dominio, URI, red y tiempos.
6. Gozne consume el nonce dentro de la misma operación lógica que crea la
   sesión.
7. Devuelve cookie `__Host-gozne-session` y datos públicos mínimos.

## Cookie

Valores iniciales obligatorios:

```text
Secure
HttpOnly
SameSite=Strict
Path=/
sin atributo Domain
```

El identificador será aleatorio, opaco y rotará después de autenticar. No
incluirá dirección de wallet, rol ni otros datos legibles.

## Contrato de forward-auth

Una validación correcta podrá devolver al proxy:

```text
X-Gozne-Identity: <identificador interno>
X-Gozne-Role: <lista acotada>
X-Gozne-Application: <aplicación>
X-Gozne-Session: <identificador de auditoría no secreto>
```

Los nombres definitivos se fijarán antes de implementar. El proxy debe borrar
siempre cualquier cabecera `X-Gozne-*` recibida del cliente y añadir únicamente
las generadas tras validar la sesión.

Respuestas esperadas:

- `2xx`: acceso permitido.
- `401`: no existe una sesión válida.
- `403`: identidad válida, pero sin autorización para la aplicación.
- `429`: límite de peticiones.
- `503`: Gozne no puede validar con seguridad; el proxy debe cerrar el acceso.

## Errores

Formato previsto:

```json
{
  "error": {
    "code": "AUTH_INVALID_PROOF",
    "message": "Authentication could not be completed",
    "request_id": "synthetic-example"
  }
}
```

Los errores públicos no deben revelar si una wallet concreta está autorizada.
Firmas, mensajes completos, cookies y tokens nunca aparecen en respuestas de
error ni logs.

## CLI inicial

```text
gozne config check
gozne identity add
gozne identity list
gozne wallet attach
gozne wallet disable
gozne session list
gozne session revoke
gozne audit export
gozne doctor
```

La CLI deberá admitir salida humana y JSON, códigos de salida estables y modo no
interactivo. Ningún comando mostrará secretos por defecto.
