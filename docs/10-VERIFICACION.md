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

La matriz no está completa: quedan carga sostenida, corte real de proceso
durante escrituras, disco físicamente lleno, pruebas de navegadores/extensiones
reales y revisión externa. Los proveedores simulados de Rabby/MetaMask prueban
la selección en el cliente, no certifican todas las versiones de esas
extensiones.

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
