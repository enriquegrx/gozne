# Evidencia y controles de la alpha

Cada push y pull request ejecuta formato, lint, compilación, tests, auditoría
npm, escaneo de secretos e integración HTTPS en Linux. Las dependencias se
instalan con lockfile y sin scripts de instalación. Las imágenes y acciones se
fijan por digest o commit.

## Seguridad del estado

Las pruebas cubren firmas EVM y SIWS, replay concurrente, aislamiento del
desafío por navegador, caducidad, permisos por aplicación, CSRF y cabeceras
falsificadas. También fuerzan fallos de inserción de sesión, fallos de auditoría
y bloqueo por otro escritor SQLite. Se comprueba que no hay cookies de éxito ni
consumo parcial del desafío cuando falla la transacción. Un fallo al guardar una
política o cerrar sesión conserva el estado anterior.

La recuperación se prueba con cambios pendientes en el WAL y con bases
corruptas, incompatibles o con política inválida. Restaurar invalida todas las
sesiones y los desafíos, conserva la política y permite un login nuevo.

## Caída, almacenamiento lleno y concurrencia

```sh
node scripts/test-resilience.mjs
```

Requiere la imagen `gozne:dev` ya construida y las dependencias npm instaladas.
Crea contenedores con nombres aleatorios y wallets efímeras; nunca utiliza el
volumen de la demo. El worker auxiliar solo se monta en esos contenedores y
requiere una variable de test explícita. Al terminar se eliminan los recursos
creados para la prueba.

Se comprueban tres escenarios:

- **Caída con SIGKILL:** un escritor auxiliar abre una transacción, modifica una
  sesión y fuerza páginas sin confirmar al WAL. Se mata el contenedor entero,
  incluido el gateway. Al volver, esas escrituras no aparecen y la base pasa
  `quick_check`. Un segundo apagado comprueba que una revocación y un nonce
  consumido ya confirmados sobreviven. No se afirma haber interrumpido cada
  instrucción posible del código de login.
- **Almacenamiento lleno:** se llena un tmpfs de 8 MiB hasta obtener un error
  real `ENOSPC`, tras vaciar el WAL confirmado mediante checkpoint. Login,
  logout y edición de política deben fallar sin emitir cookies de éxito ni dejar
  cambios parciales. Al liberar espacio, el mismo desafío vuelve a servir y el
  logout funciona sin reiniciar. Esto prueba el error del sistema de archivos;
  no simula un corte eléctrico ni un fallo del dispositivo físico.
- **Concurrencia:** ocho clientes hacen 40 validaciones iniciales y después
  envían peticiones durante 15 segundos, con una pausa de 50 ms entre peticiones
  por cliente. Se admiten únicamente respuestas 200 y 429, se verifica la cuota
  por IP y se comprueba que `/healthz` sigue disponible. Una revocación
  posterior debe seguir vigente tras reiniciar.

Estas pruebas usan HTTP limitado a loopback y cookies sintéticas enviadas por el
cliente de test para aislar el comportamiento del gateway. La suite separada
`test-proxy.mjs` comprueba el flujo completo sobre HTTPS y Nginx.

`reports/resilience.json` contiene el ID de imagen, fechas, contadores y
latencias p50/p95/máxima. Se guarda también cuando falla un escenario, sin
firmas, cookies ni direcciones de wallets. GitHub lo adjunta al artefacto
`security-reports`.

Las latencias dependen del equipo y del runner. La mayoría de las peticiones
bajo sobrecarga pueden ser rechazos 429: esos tiempos no miden capacidad de
validación exitosa. Es una prueba corta de resistencia y límites, no un
benchmark de producción ni un ensayo prolongado de carga.

La matriz no está completa: quedan carga prolongada, pérdida de energía, pruebas
de navegadores/extensiones reales y revisión externa. Los proveedores simulados
de Rabby/MetaMask prueban la selección en el cliente, no certifican todas las
versiones de esas extensiones.

## Inventario y escaneo de imagen

```sh
mkdir -p reports
npm sbom --omit=dev --sbom-format=cyclonedx > reports/dependencies.cdx.json
sh scripts/scan-image.sh
```

El inventario npm enumera dependencias de producción. Trivy examina un archivo
exportado de la imagen `gozne:dev`, sin acceso al socket de Docker. Genera
`image-scan.json` y `image.cdx.json` (CycloneDX, con paquetes del sistema y de
la aplicación). Un hallazgo HIGH o CRITICAL, incluso sin parche disponible, hace
fallar el paso. Un fallo de descarga o ejecución tampoco cuenta como aprobado.
La base de vulnerabilidades se actualiza en cada ejecución; una imagen idéntica
puede recibir nuevos hallazgos con el tiempo.

GitHub conserva los JSON en el artefacto `security-reports` durante 30 días,
incluso si falla el escaneo. No se publican bases de datos, wallets de usuarios
ni archivos del estado local. Los informes generados se excluyen de Git.

La imagen usa Node 24.20.0 sobre Alpine, fijado por digest, y actualiza
`libcrypto3`/`libssl3` a `3.5.8-r0` para corregir CVE-2026-14456. npm y Yarn se
usan durante la construcción y se retiran de la imagen final. Las pruebas Linux
y HTTPS se ejecutan con esa base; añadir módulos nativos requerirá revisar su
compatibilidad con musl.

La imagen de la aplicación, sus dependencias y el escáner están fijados, pero
todavía no se afirma reproducibilidad binaria ni hay imágenes de release
firmadas. La imagen de Nginx de la demo no forma parte del escaneo de
`gozne:dev`.

Referencias: [SBOM de npm](https://docs.npmjs.com/cli/v11/commands/npm-sbom),
[escaneo de imágenes con Trivy](https://trivy.dev/docs/dev/references/configuration/cli/trivy_image/).
