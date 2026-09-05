# Colaborar con Gozne

Para proponer cambios grandes, abre una issue explicando el problema antes de
escribir la implementación. Para un fallo concreto, incluye cómo reproducirlo.

## Desarrollo

Necesitas Node 24.20.0 y npm. Con nvm: `nvm install && nvm use`.

```sh
npm ci
npm run check
```

`npm run check` comprueba formato, lint, compilación y pruebas. Para aplicar el
formato: `npm run format`. Las pruebas usan bases de datos temporales.

Con Docker también puedes comprobar el contenedor:

```sh
docker build -t gozne:dev .
node scripts/smoke-container.mjs
```

Los cambios de seguridad necesitan pruebas del comportamiento que corrigen. Usa
exclusivamente datos sintéticos, dominios `.test` y claves efímeras creadas por
los tests. Nunca añadas datos de producción.

La licencia de distribución está pendiente de definición. Antes de enviar una
contribución sustancial, consulta al mantenedor para aclarar sus condiciones.

La [guía de operación](docs/08-OPERACION.md) documenta las pruebas HTTPS con
wallets sintéticas y la demo en OrbStack.
