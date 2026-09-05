<div align="center">

# 🚪 Gozne

**Firma. Gira. Entra.**

Tu wallet abre la puerta. Tu servidor decide quién pasa.

[![CI](https://github.com/enriquegrx/gozne/actions/workflows/ci.yml/badge.svg)](https://github.com/enriquegrx/gozne/actions/workflows/ci.yml)
![Estado: en desarrollo](https://img.shields.io/badge/estado-en_desarrollo-eab308)
![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-estricto-3178C6?logo=typescript&logoColor=white)

</div>

Gozne es un proyecto de **autenticación web con wallets, alojado en tu propio
servidor**. La idea: proteger una aplicación HTTP sin tener que meter lógica
blockchain dentro de ella.

El usuario firma un mensaje con su wallet. Gozne comprueba la firma, crea una
sesión y le indica al proxy si puede dejarlo entrar. La aplicación recibe una
identidad verificada y sigue a lo suyo.

> 🛠️ **Alpha funcional.** Ya hay login EVM y Solana, sesiones revocables,
> permisos por aplicación y una demo con Nginx. Falta completar el
> endurecimiento y la revisión para una versión estable.

## ¿Para qué sirve?

Para poner una puerta común delante de varias herramientas: una documentación
privada, un panel interno, una intranet o un servicio que has montado en casa.
Si las personas que van a entrar ya usan wallets, no hace falta inventar otra
contraseña para cada web.

Puedes elegir qué identidades entran a cada aplicación, asignarles roles y
revocar una sesión desde tu servidor.

```text
                  Firma un mensaje de acceso
   👤 + wallet ─────────────────────────────────► Gozne
                                                    │
                                            Comprueba la firma
                                            y crea una sesión
                                                    │
   Navegador ──► Nginx / Traefik ── consulta ──────────┘
                       │
                 Acceso permitido
                       ▼
                 Tu aplicación
```

La demo incluida implementa este flujo con Nginx.

## 🔑 Firmar para entrar

Gozne está orientado a wallets **EVM y Solana**. El acceso se basa en firmar un
mensaje legible: dominio, propósito y caducidad del intento de login.

- No pide frases semilla ni claves privadas.
- No necesita transacciones ni pagos para iniciar sesión.
- No consulta tu saldo para decidir quién eres.
- Una firma no concede acceso para siempre: las sesiones caducan y se revocan.

Para EVM implementamos SIWE con cuentas externas (EOA). Para Solana usamos
Sign-In With Solana: la demo necesita una wallet compatible con `signIn`, como
Phantom. WalletConnect, smart wallets y OIDC quedan para más adelante.

## Qué hay hoy

- 🔑 Firmas EVM y Solana con desafíos de un solo uso ligados al navegador.
- 🍪 Sesiones opacas de una hora, logout con CSRF y revocación por CLI.
- 🚦 Identidades, wallets y roles explícitos por aplicación. Sin permiso, no
  pasas.
- 🗃️ SQLite persistente, migraciones y auditoría de operaciones.
- 🐳 Contenedores sin root, Nginx y pruebas del flujo completo por HTTPS.

## 🚀 Demo en Mac con OrbStack

Con OrbStack arrancado:

```sh
git clone https://github.com/enriquegrx/gozne.git
cd gozne
docker compose -f examples/compose/orbstack.yaml up --build -d --wait
docker compose -f examples/compose/orbstack.yaml exec gateway gozne policy apply /app/policy.json
```

Abre **https://gozne.orb.local**. OrbStack pone el dominio y el HTTPS local. La
política inicial no tiene wallets autorizadas. Añade tu dirección pública
(sustituye `TU_DIRECCION_PUBLICA`; nunca una clave privada):

```sh
docker compose -f examples/compose/orbstack.yaml exec gateway gozne wallet attach example-user evm TU_DIRECCION_PUBLICA
```

Para Solana, cambia `evm` por `solana`. Conecta la wallet, firma y entra en la
aplicación de prueba. Verás la identidad y los roles que recibe del proxy.

Los datos sobreviven a los reinicios. **No vuelvas a aplicar la política vacía**
si ya has añadido wallets: una importación sustituye toda la política.

```sh
docker compose -f examples/compose/orbstack.yaml down
```

¿Usas otro entorno? La [guía de operación](docs/08-OPERACION.md) incluye una
demo HTTPS portable, gestión de permisos y revocación. El Compose de la raíz
arranca solo la API en `127.0.0.1:3001`; el login necesita un proxy HTTPS.

### Para desarrollar

Necesitas **Node.js 24.20.0**. Si utilizas nvm:

```sh
nvm install
nvm use
npm ci
npm run check
npm start
```

`npm run check` ejecuta formato, lint, compilación y pruebas. `npm start` usa la
compilación resultante y crea la base local en `state/gozne.sqlite`.

En otra terminal puedes ejecutar:

```sh
npm run cli -- config check --json
npm run cli -- doctor --json
```

`config check` valida las opciones sin crear archivos. `doctor` revisa una base
ya inicializada; si todavía no has arrancado el servicio, devuelve un error.

## Configuración

| Variable          | Valor local por defecto | Uso                                |
| ----------------- | ----------------------- | ---------------------------------- |
| `GOZNE_HOST`      | `127.0.0.1`             | Dirección de escucha               |
| `GOZNE_PORT`      | `3001`                  | Puerto HTTP                        |
| `GOZNE_DATABASE`  | `./state/gozne.sqlite`  | Archivo SQLite                     |
| `GOZNE_LOG_LEVEL` | `info`                  | `silent`, `info`, `warn` o `error` |

El contenedor escucha en `0.0.0.0` y guarda el estado en `/app/state`. No hay
una clave de firma de sesiones que configurar. Las variables se leen del
entorno; los archivos `.env` no se cargan automáticamente al ejecutar Node.

Sin política importada, las rutas de autenticación responden `503`.
`GET /v1/auth/validate?application=demo` permite al proxy comprobar una sesión;
esta ruta debe quedar fuera de la exposición pública.

## 📚 Un poco más de detalle

- [Visión y alcance](docs/01-VISION-Y-ALCANCE.md)
- [Arquitectura](docs/02-ARQUITECTURA.md)
- [Contrato HTTP actual](openapi.yaml) y
  [Flujo de autenticación](docs/03-API-Y-CONTRATOS.md)
- [Modelo de amenazas](docs/04-SEGURIDAD.md)
- [Roadmap](docs/06-ROADMAP.md)
- [Decisiones técnicas](docs/07-DECISIONES.md)
- [Cómo colaborar](CONTRIBUTING.md) · [Reportar una vulnerabilidad](SECURITY.md)

Gozne está en una etapa temprana, sin auditoría externa ni versión estable. La
licencia de distribución está pendiente de definición; todavía no se ha
concedido una licencia de código abierto.
