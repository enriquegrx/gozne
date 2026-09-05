# Visión y alcance

## Problema

Una aplicación que quiere autenticar usuarios mediante wallets suele repetir el
mismo trabajo delicado: descubrir el proveedor, emitir el mensaje, evitar
replays, verificar la firma, crear una sesión, revocarla y traducir la wallet a
roles internos. Repetir ese código en cada portal aumenta el coste y el riesgo.

## Propuesta

Gozne centraliza ese flujo y entrega a la aplicación una identidad web ya
verificada. La aplicación protegida no necesita acceso a claves ni librerías
blockchain; confía en una respuesta de autorización emitida por Gozne dentro de
un perímetro de proxy definido.

```text
wallet → firma de login → Gozne → sesión web → aplicación protegida
```

## Usuarios objetivo

- Administradores de portales privados e intranets.
- Equipos que ya trabajan con identidades basadas en wallets.
- Aplicaciones autohospedadas que puedan integrarse por `forward-auth`.
- Proyectos pequeños o medianos que quieran revocación centralizada.

No es una buena opción inicial para productos que necesiten onboarding masivo de
usuarios sin experiencia cripto, login social, alta disponibilidad global o
compatibilidad inmediata con todas las smart wallets.

## Principios de producto

1. **Prueba de posesión, no custodia.** Gozne nunca solicita ni almacena claves
   privadas o frases semilla.
2. **Sin transacciones.** El login firma un mensaje legible y no mueve fondos.
3. **Seguro por defecto.** La administración está deshabilitada o aislada; los
   fallos de persistencia cierran el acceso.
4. **Integración sencilla.** Una aplicación HTTP debe poder protegerse con un
   proxy y pocas variables de configuración.
5. **Estado revocable.** Una firma válida no concede acceso permanente; la
   sesión y la política se comprueban contra estado vivo.
6. **Estándares mantenidos.** SIWE, Sign-In With Solana y librerías revisadas;
   no se diseña criptografía propia.
7. **Portabilidad.** Sin dominios, branding ni dependencias operativas del
   proyecto de origen.

## Alcance de 0.1.0

### Incluido

- EVM y Solana.
- Whitelist e identidades con roles por aplicación.
- Sesiones de servidor persistentes y revocables.
- CLI para identidades, wallets, sesiones, configuración y diagnóstico.
- Integración `auth_request` de Nginx y contrato genérico de cabeceras.
- Contenedor no root, Compose de ejemplo y almacenamiento local.
- OpenAPI, pruebas automatizadas, SBOM y guía de operación.

### Fuera de alcance

- OAuth 2.0 u OpenID Connect completos.
- WalletConnect y experiencia móvil universal.
- ERC-1271/ERC-6492 para smart wallets.
- Panel administrativo web.
- PostgreSQL, Redis, clustering o Kubernetes.
- Autorización automática por NFT o saldo.
- Recuperación de wallets o identidades perdidas.

## Indicadores de éxito

- Un integrador nuevo puede levantar Gozne y proteger una web de ejemplo en
  menos de diez minutos siguiendo únicamente el README.
- Replay, firma alterada, dominio incorrecto y sesión revocada son rechazados.
- Reiniciar el servicio no invalida sesiones vigentes ni revive sesiones
  revocadas.
- El contenedor funciona sin root, con filesystem de solo lectura salvo estado.
- Los ejemplos y artefactos solo contienen datos sintéticos y no incluyen
  secretos.
