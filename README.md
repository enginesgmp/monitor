# Portal de iniciativas — Netlify v23

Esta versión consulta automáticamente dos archivos Excel públicos alojados en Microsoft:

- Transformación: hoja `DATOS`
- Tecnología: hoja `Hoja1`

## Comportamiento

- Al abrir el portal se consultan ambas fuentes.
- El botón **Actualizar todo** fuerza una nueva lectura.
- La función Netlify descarga los archivos y evita problemas de CORS/redirecciones.
- El navegador procesa los Excel con SheetJS.
- Los registros se actualizan por código.
- No se eliminan registros ausentes del Excel.
- Si una fuente falla, se conserva la última copia válida en el navegador.

## Vista Gerencial de Tecnología

La Vista Gerencial de Tecnología usa una clasificación independiente llamada `dimension`, leída desde la columna `Dimensión` de la hoja `DATOS`. Se aceptan los encabezados `DIMENSIÓN`, `DIMENSION`, `Dimensión` y `Dimension`.

Si el endpoint o el Excel de Tecnología no entrega la columna, el portal marca el registro como `SIN DIMENSIÓN`. No se infiere la dimensión desde nombre, área, responsable ni descripción, y no se reutilizan macrofrentes de Transformación.

## Publicación manual en Netlify

1. Comprima o cargue toda esta carpeta, no solo `index.html`.
2. En Netlify seleccione **Add new project > Deploy manually**.
3. Arrastre el archivo ZIP o la carpeta completa.
4. Netlify detectará `netlify.toml` y publicará la función.

## Variables opcionales

Los enlaces actuales tienen valores de respaldo dentro de la función para facilitar el piloto.
En Netlify puede reemplazarlos mediante variables de entorno:

- `TRANSFORMATION_FILE_URL`
- `TECHNOLOGY_FILE_URL`

Ruta: **Project configuration > Environment variables**.

Después de cambiar una variable, vuelva a desplegar el sitio.

## Limitación del piloto

Los Excel son la fuente de lectura. Las ediciones realizadas dentro del portal todavía se guardan en el navegador y no escriben de regreso en OneDrive o SharePoint.
