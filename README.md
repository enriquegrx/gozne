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

> 🛠️ **Estamos construyéndolo.** Ya puedes arrancar el servicio, probar la API
> mínima y comprobar SQLite. El login con wallets todavía no está implementado.
> Esta versión no sirve para proteger una aplicación real.

## ¿Para qué sirve?

Para poner una puerta común delante de varias herramientas: una documentación
privada, un panel interno, una intranet o un servicio que has montado en casa.
Si las personas que van a entrar ya usan wallets, no hace falta inventar otra
contraseña para cada web.

El objetivo es que puedas elegir qué identidades entran a cada aplicación,
asignarles roles y revocar una sesión desde tu servidor.

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

Ese es el flujo previsto. La integración con proxies llegará con la
autenticación.

## 🔑 Firmar para entrar

Gozne estará orientado a wallets **EVM y Solana**. El acceso se basará en firmar
un mensaje legible: dominio, propósito y caducidad del intento de login.

- No pide frases semilla ni claves privadas.
- No necesita transacciones ni pagos para iniciar sesión.
- No consulta tu saldo para decidir quién eres.
- Una firma no concede acceso para siempre: las sesiones caducan y se revocan.

Para EVM, el objetivo es implementar SIWE / EIP-4361 completo. Para Solana,
Sign-In With Solana; cualquier compatibilidad adicional tendrá límites
explícitos.

## Qué hay hoy

| Ya funciona                                      | Lo siguiente                          |
| ------------------------------------------------ | ------------------------------------- |
| API mínima con Fastify y TypeScript              | Login EVM y Solana                    |
| SQLite y migraciones transaccionales             | Nonces de un solo uso                 |
| CLI para validar configuración y revisar la base | Sesiones opacas y revocación          |
| Contenedor sin root y Compose local              | Identidades y permisos por aplicación |
| Pruebas, lint y CI con escaneo de secretos       | Integración Nginx y ejemplo de login  |

El panel administrativo web, WalletConnect, smart wallets y OIDC quedan para más
adelante. La primera versión se administrará por CLI.

## 🚀 Pruébalo

### Con Docker

```sh
git clone https://github.com/enriquegrx/gozne.git
cd gozne
docker compose up --build -d

curl http://127.0.0.1:3001/healthz
curl http://127.0.0.1:3001/version
docker compose exec gozne-gateway gozne doctor --json
```

`/healthz` devuelve `{"status":"ok"}` cuando puede consultar SQLite. `/version`
indica la versión y muestra `"authentication": false` mientras se desarrolla el
login.

Compose expone el servicio solo en tu equipo, en el puerto **3001**. La base de
datos vive en un volumen persistente y se conserva al reiniciar el contenedor.
Si tienes ese puerto ocupado, cambia el primer `3001` en `compose.yaml`.

Para detenerlo:

```sh
docker compose down
```

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
claves que configurar en esta fase. Las variables se leen del entorno; los
archivos `.env` no se cargan automáticamente al ejecutar Node.

La ruta `GET /v1/auth/validate` está reservada y **siempre devuelve `503`**.
Todavía no hay ningún camino que autorice una petición.

## 📚 Un poco más de detalle

- [Visión y alcance](docs/01-VISION-Y-ALCANCE.md)
- [Arquitectura](docs/02-ARQUITECTURA.md)
- [Contrato HTTP actual](openapi.yaml) y
  [API prevista](docs/03-API-Y-CONTRATOS.md)
- [Modelo de amenazas](docs/04-SEGURIDAD.md)
- [Roadmap](docs/06-ROADMAP.md)
- [Decisiones técnicas](docs/07-DECISIONES.md)
- [Cómo colaborar](CONTRIBUTING.md) · [Reportar una vulnerabilidad](SECURITY.md)

Gozne está en una etapa temprana, sin auditoría externa ni versión estable. La
licencia de distribución está pendiente de definición; todavía no se ha
concedido una licencia de código abierto.
