# Operación de la alpha

## Demo con OrbStack

Desde la raíz, con OrbStack arrancado:

```sh
docker compose -f examples/compose/orbstack.yaml up --build -d --wait
docker compose -f examples/compose/orbstack.yaml exec gateway gozne policy apply /app/policy.json
docker compose -f examples/compose/orbstack.yaml exec gateway gozne wallet attach example-user evm TU_DIRECCION_PUBLICA
```

Abre https://gozne.orb.local. OrbStack termina TLS delante del Nginx de la demo.
Puede solicitar instalar su certificado local la primera vez. Para Solana, usa
`solana` en el comando y una wallet con `signIn`. La demo soporta proveedores
EVM EIP-6963 (Rabby, MetaMask y otros proveedores compatibles) y Phantom para
Solana. Las extensiones deben estar instaladas en el navegador que abre la demo.
El selector exige elegir una wallet detectada: no utiliza `window.ethereum` ni
abre una extensión alternativa si la elegida no está disponible. Usa la URL
HTTPS de la demo, no el archivo HTML directamente. La detección sigue la
[integración oficial de Rabby](https://rabby.io/docs/integrating-rabby-wallet).
La compatibilidad del protocolo no sustituye una prueba con cada extensión. EVM
usa Ethereum (chain ID 1); la política incluye Solana mainnet y devnet. La firma
no envía una transacción.

Solo se autoriza la dirección pública que añadas. La identidad `example-user` ya
tiene el rol `reader` para `demo`. El volumen `gozne-demo_state` conserva
política y sesiones. `down` detiene la demo; `down -v` borra esos datos.

## Demo HTTPS portable

```sh
sh scripts/demo-certs.sh
docker compose -f examples/compose/compose.yaml up --build -d --wait
docker compose -f examples/compose/compose.yaml exec gateway gozne policy apply /app/policy.json
docker compose -f examples/compose/compose.yaml exec gateway gozne wallet attach example-user evm TU_DIRECCION_PUBLICA
```

Abre https://localhost:8443. El certificado de ejemplo es autofirmado y dura
siete días; revisa y confía en él localmente para probar con navegador. No es un
certificado de despliegue. Las dos variantes comparten nombre de proyecto: detén
una antes de arrancar la otra y aplica la política del origen elegido.

## Política y CLI

La fuente de verdad es SQLite. `policy apply` importa un JSON completo; no hay
recarga automática del archivo montado. Antes de editar, exporta el estado para
conservar los cambios hechos por CLI:

```sh
docker compose -f examples/compose/orbstack.yaml exec -T gateway gozne policy export --json > policy.local.json
```

`examples/orbstack-policy.json` muestra el formato. Cada identidad tiene wallets
y `grants` por aplicación. Se exige un permiso explícito no vacío y todos los
`requiredRoles`. `identity add` crea una identidad sin permisos: hay que editar
sus grants y volver a importar. Un JSON inválido conserva la política anterior.

Los siguientes comandos se ejecutan con `gozne` dentro del contenedor; usa
`gozne --help` para ver sus argumentos:

```text
policy check ARCHIVO
policy apply ARCHIVO
policy export
identity list
identity add ID
wallet attach ID evm DIRECCION
wallet disable evm DIRECCION
session list
session revoke ID_DE_SESION
audit export
doctor
```

Todos admiten `--json`. Los IDs de sesión son identificadores de auditoría, no
cookies utilizables. Cualquier cambio efectivo de política revoca **todas** las
sesiones y borra los desafíos pendientes. Reimportar la misma política no los
modifica. La CLI detecta modificaciones concurrentes durante sus ediciones.

## Integración del proxy

Login, API y aplicación comparten un origen HTTPS. Las cookies son host-only;
esta alpha no proporciona SSO entre dominios. Nginx consulta internamente
`/v1/auth/validate?application=demo` antes de servir `/private/`. La aplicación
recibe identidad, roles, aplicación e ID público de sesión. La lista permitida
de cabeceras elimina valores `X-Gozne-*` enviados por el cliente y no reenvía
cookies a la aplicación sintética.

En un despliegue real, el gateway y la aplicación deben estar en una red privada
accesible solo desde el proxy. Los dominios automáticos de OrbStack son una
comodidad local de desarrollo, no ese aislamiento de producción. No expongas
`validate` directamente. Si Gozne falla, Nginx deniega el acceso (puede
responder 500 al fallar `auth_request`). `/healthz` comprueba lectura, no
disponibilidad de escrituras ni una política lista para autenticar.

## Límites actuales

Una instancia, SQLite local y reloj del servidor correcto. Desafíos de cinco
minutos y sesiones de una hora, sin renovación automática. Límite de 20
peticiones/minuto por IP en cada ruta de emisión y verificación, y 120 en las
demás rutas de autenticación. Los contadores viven en memoria. No se confía en
`X-Forwarded-For`: detrás de Nginx sus usuarios comparten la cuota de la IP del
proxy. Antes de ampliar el uso hay que dimensionar y revisar este límite.

Máximo 1.000 desafíos almacenados y cinco por contexto de navegador durante su
TTL, incluyendo consumidos; 10.000 sesiones. Auditoría limitada a 50.000 eventos
y 30 días. SQLite contiene los mensajes de desafío, direcciones y permisos;
protege el volumen. Los logs no contienen firmas, cookies, cuerpos, URLs ni IPs.

La [guía de recuperación](09-RECUPERACION.md) describe copias en caliente y
restauración a una base nueva. Los ensayos de carga siguen pendientes. No se
soporta degradar a un binario con esquema anterior.

## Verificación

```sh
npm run check
npm audit --audit-level=moderate
docker build -t gozne:dev .
node scripts/smoke-container.mjs
node scripts/test-proxy.mjs
```

La última prueba genera wallets efímeras y certificado temporal, verifica ambos
logins por HTTPS, revocación, logout, cabeceras y denegación al parar Gozne.
Limpia únicamente su propio proyecto Compose y sus datos sintéticos.
