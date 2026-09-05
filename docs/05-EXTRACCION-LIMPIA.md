# Procedencia y limpieza del proyecto

Gozne se desarrolla en un repositorio nuevo, con historial independiente. La
experiencia de prototipos anteriores sirve como referencia de comportamiento;
los archivos de implementación de esta primera fase se han escrito para Gozne.

## Reglas para incorporar material

- Revisar titularidad y licencia antes de reutilizar código de terceros.
- Mantener las referencias privadas y sus evidencias fuera del repositorio
  público.
- Utilizar dominios `.test` y datos sintéticos en ejemplos y pruebas.
- No incorporar historiales, configuraciones operativas, wallets reales, claves,
  cookies, sesiones, logs ni datos personales de otros sistemas.
- Revisar dependencias, archivos publicados y contexto de construcción Docker.

## Comprobaciones

La CI ejecuta Gitleaks sobre archivos e historial y audita las dependencias. El
contexto Docker usa una lista explícita de archivos necesarios para construir.
El estado local, las dependencias instaladas y las compilaciones quedan fuera de
Git.

Antes de cada publicación se revisan también manualmente los ejemplos, la
documentación y los cambios preparados. Un escáner no demuestra por sí solo la
ausencia de datos privados.
