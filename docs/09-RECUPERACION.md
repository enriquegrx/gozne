# Copias y recuperación

La CLI de la alpha permite copiar una base activa y restaurarla en **un archivo
nuevo**. No sustituye la base que está usando el servidor. Los comandos rechazan
un destino existente, enlaces simbólicos y nombres con restos de WAL/journal.

## Hacer una copia

Con la demo de OrbStack arrancada:

```sh
docker compose -f examples/compose/orbstack.yaml exec gateway gozne database backup /app/state/backup-01.sqlite --json
```

Elige un nombre nuevo para cada copia. Se usa la API de backup de SQLite, que
incluye los cambios confirmados en el WAL mientras el servicio sigue activo.
Copiar únicamente `gozne.sqlite` con `cp` mientras está abierto puede perder
esos cambios. Una carga continua de escrituras puede alargar la copia.

Gozne comprueba integridad, migraciones y política, prepara un archivo privado y
lo publica completo, sin sobrescribir un destino creado por otro proceso. La
copia es autocontenida, con permisos `0600`; no requiere archivos `-wal` o
`-shm`.

Saca la copia del volumen para que sobreviva a la pérdida del volumen:

```sh
mkdir -p backups
chmod 700 backups
docker compose -f examples/compose/orbstack.yaml cp gateway:/app/state/backup-01.sqlite backups/backup-01.sqlite
chmod 600 backups/backup-01.sqlite
```

Elige también un destino local nuevo. `backups/` está excluido de Git. Guarda
una segunda copia en tu sistema habitual de backups. Estos archivos contienen
política, direcciones públicas vinculadas a identidades, auditoría y hashes de
sesión: requieren acceso restringido y cifrado si salen del equipo.

## Restaurar para revisar

```sh
docker compose -f examples/compose/orbstack.yaml exec gateway gozne database restore /app/state/backup-01.sqlite /app/state/recovered-01.sqlite --json
docker compose -f examples/compose/orbstack.yaml exec -e GOZNE_DATABASE=/app/state/recovered-01.sqlite gateway gozne doctor --json
docker compose -f examples/compose/orbstack.yaml exec -e GOZNE_DATABASE=/app/state/recovered-01.sqlite gateway gozne policy export --json
```

La restauración preserva la política y la auditoría de la copia, elimina todas
las sesiones y desafíos e incorpora el evento `database.restored`. Todo el mundo
tendrá que firmar de nuevo. No arranques directamente el archivo de backup:
contiene sesiones del momento en que se tomó, incluidas las que pudieran haberse
revocado después.

**Revisa los permisos antes de poner la base recuperada en servicio.** Una copia
antigua también contiene una política antigua: puede autorizar una wallet que se
deshabilitó después. Aplica la política vigente a la base recuperada si la
tienes, usando la misma variable `GOZNE_DATABASE`.

Solo restaura copias propias y confiables. La validación detecta corrupción y
esquemas incompatibles; no demuestra la procedencia del archivo ni sustituye una
firma o verificación de tu sistema de backups.

## Poner en servicio la base recuperada

Una vez revisada, crea un override local:

```yaml
# examples/compose/recovery.local.yaml
services:
  gateway:
    environment:
      GOZNE_DATABASE: /app/state/recovered-01.sqlite
```

Detén el gateway y arráncalo con ambos archivos, conservando la base original:

```sh
docker compose -f examples/compose/orbstack.yaml stop gateway
docker compose -f examples/compose/orbstack.yaml -f examples/compose/recovery.local.yaml up -d --wait
```

Comprueba `/healthz`, inicia una sesión nueva y prueba la aplicación protegida.
Usa ambos archivos en los siguientes comandos de Compose para mantener la ruta
elegida. No copies archivos sobre una base abierta y no borres a mano un WAL:
puede contener las últimas escrituras confirmadas.

## Versiones y límites

Estos comandos exigen el esquema exacto que conoce el ejecutable. Conserva la
versión o digest de imagen junto a cada copia. Para recuperar un esquema
antiguo, usa primero el binario correspondiente y sigue después el procedimiento
de actualización, probándolo en otra base antes del cambio real. Esta alpha no
incluye migraciones hacia atrás ni garantiza recuperación ante cualquier fallo
físico del almacenamiento.

Las pruebas automatizadas cubren WAL confirmado, integridad, rechazo de
sobrescrituras y enlaces, política inválida, permisos y eliminación de sesiones.
La integración HTTPS ejecuta backup, restore y doctor dentro de contenedores con
datos sintéticos. Queda pendiente el ensayo completo de desastre en un piloto
independiente.

Referencia técnica:
[backup de SQLite en Node](https://nodejs.org/api/sqlite.html#sqlitebackupsource-db-path-options).
