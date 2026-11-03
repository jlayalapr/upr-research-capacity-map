# UPR Research Capacity Map: arquitectura

```
ORCID      → quién es el investigador          (declarado)       js/sources/orcid.js
OpenAlex   → qué publica y qué temas trabaja   (bibliográfico)   js/sources/openalex.js
NIH / NSF  → qué se le ha financiado           (financiamiento)  js/sources/funding.js
VIVO       → representación institucional     (exportación)     js/export/vivo.js
Research Capacity Intelligence Layer → capacidades (inferido)    js/capacity/*.js
UPR Research Capacity Map → agregación, consulta y mapa          js/aggregate.js, js/map.js
```

Abrir `index.html` en el navegador. No requiere servidor ni instalación.

## Modelo de datos (un registro por investigador)

```js
R = {
  orcid,
  identity:    { given, family, credit, emails, source:"ORCID", kind:"declared", retrieved },
  affiliation: { campus, role, dept, college, org, city, start, end, source:"ORCID", kind:"declared" },
  sources: {
    orcid:    { search, ... },
    openalex: { match:{status, method, score, reasons, note}, author, alternates,
                unverified_candidates, works:[...], metrics, source:"OpenAlex", kind:"bibliographic" },
    nih:      { awards:[{...proyecto, match:{level, confidence, reasons, role}}], source:"NIH RePORTER", kind:"funding" },
    nsf:      { awards:[...], source:"NSF Awards", kind:"funding" },
    // futuras: crossref, pubmed, dspace, infoed, scopus, wos
  },
  discrepancies: [{ field, orcid, openalex, note }],   // nunca se sobrescribe ORCID
  capacity: {                                          // capa de capacidades (inferido)
    research_areas, expertise, primary_field, topics:{primary, secondary, emerging},
    methods, technologies, problems, populations, geography,
    collaboration, activity, selected_publications, funding_signals,
    evidence: [ ...todas las capacidades en formato evidencia ]
  }
}
```

### Evidencia (trazabilidad de cada capacidad)

```json
{ "capacity": "Machine Learning", "category": "Method", "confidence": 0.91,
  "supporting_works": 14, "supporting_work_ids": ["W123", "..."], "years": "2019-2026",
  "source": "OpenAlex", "kind": "inferred", "method": "lexicon" }
```

## Reglas de vinculación (ORCID → OpenAlex)

1. `GET /authors/orcid:<id>` (consulta de un solo registro, **gratuita**). Solo se acepta un ORCID exacto.
2. Si hay varios perfiles con el mismo ORCID, se ordenan por: institución UPR, mismo recinto, nombre y coincidencia entre el departamento y los topics. Sus trabajos se combinan, porque el mismo ORCID es la misma persona.
3. Si el ORCID no está en OpenAlex, se buscan candidatos por nombre **solo para revisión manual**. Nunca se usan para métricas ni capacidades.
4. Si OpenAlex indica otra institución o recinto, se registra en `discrepancies` y se muestran ambos valores.

## Cómo se infieren las capacidades

| Categoría | Método | Archivo |
|---|---|---|
| Research Areas / Topics | Topics de OpenAlex ponderados por `score × actualidad × log(citas)` (vida media de 6 años) | engine.js `deriveResearchAreas` |
| Primary / Secondary / Emerging | Primary: ≥3 trabajos · Emerging: aparece en los últimos 3 años en una trayectoria más larga | engine.js `tierTopics` |
| Expertise | Subcampos de OpenAlex con experiencia sostenida (≥3 trabajos en años distintos) | engine.js `deriveExpertise` |
| Methods, Technologies, Problems, Populations, Geography | Vocabularios ES/EN sobre título, keywords, resumen y topics. Solo menciones explícitas | lexicons.js |
| Collaboration Network | Coautorías de OpenAlex. Se excluyen los trabajos de consorcio (>100 autores) | engine.js |
| Research Activity | Active ≥2 trabajos en 3 años · Recently ≥1 en 5 · Historically · Emerging ≤6 años y ≤25 trabajos | engine.js |
| Funding Areas | Reglas sobre capacidades con evidencia. **Inferencia, no dato de agencias** | funding.js |

La confianza combina tres cosas: la cantidad de publicaciones de soporte, el peso de la capacidad dentro del perfil y su continuidad en el tiempo. Las capacidades con una sola publicación quedan marcadas (`single_evidence`).

## Agregación institucional

`capacityFacts()` produce una tabla plana con una fila por investigador × capacidad: recinto, departamento, facultad, disciplina, categoría, capacidad, confianza, evidencia, años y fuente. `aggregateCapacities(facts, dim, {category, minConfidence})` agrupa esa tabla por cualquier dimensión. `queryCapacities(texto)` responde preguntas como "¿Quién utiliza GIS?" y sugiere equipos.

## Añadir una fuente nueva

1. Crear `js/sources/<fuente>.js` con `enrich(R, signal)`. La función escribe **solo** en `R.sources.<fuente>` y usa `prov(...)`.
2. Si la fuente aporta publicaciones, normalizarlas al formato de `compactWork()` para que el motor las use.
3. Registrarla en `js/sources/registry.js` y añadir su `<script>` en `index.html`.

## Caché y límites

- **Caché:** `Map` en memoria más `localStorage` (7 días). Las claves son `oa:author:orcid:<ORCID>` y `oa:works:<AuthorID>`.
- **Límites de velocidad:** ORCID 12 req/s, OpenAlex 8 req/s.
- **Reintentos:** hasta 5, con backoff exponencial ante errores 429/5xx y de red. Se respeta `Retry-After`.
- **OpenAlex (desde el 13 de febrero de 2026):** usa una API key gratuita (`api_key=`) con presupuesto diario en USD: unos US$0.10 al día sin key y US$1 con key gratuita. Costos:
  - consulta de un solo registro: gratis (así se busca al autor por ORCID);
  - listas y filtros (páginas de publicaciones): unos US$0.0001;
  - búsqueda por texto (candidatos por nombre, opcional): unos US$0.001.

  El parámetro `mailto` ya no se usa. Si se agota el presupuesto (HTTP 429) o la key es inválida (401/403), la corrida se detiene con un mensaje y lo ya descargado queda en caché. Los resultados "no encontrado" no se guardan en el navegador.

## Financiamiento: NIH RePORTER y NSF Awards

**Descarga.** Cada fuente se descarga una sola vez para todo Puerto Rico desde el año elegido, y luego se filtran los proyectos de la UPR.
- **NIH:** `POST /v2/projects/search` con `org_states:["PR"]`, en bloques de 4 años fiscales. Los registros anuales se agrupan por *core project number*.
- **NSF:** `GET /services/v1/awards.json?awardeeStateCode=PR`, un año a la vez, con 25 registros por página.

**Vinculación.** Estas APIs no publican ORCID. Se vincula por nombre + institución UPR + recinto:

| Nivel | Regla | ¿Cuenta en el perfil? |
|---|---|---|
| high | apellido + primer nombre exactos, UPR, recinto igual o desconocido | Sí |
| medium | nombre exacto en otro recinto, o solo inicial en el mismo recinto | Solo si se activa la opción |
| ambiguous | el investigador del proyecto encaja con 2+ profesores y no hay un único "high" | No; se muestra para revisión |

Un proyecto que no es de la UPR nunca se vincula. **Limitación:** si otra persona de la UPR con el mismo nombre no está en el conjunto (por ejemplo, porque no tiene ORCID), el sistema no puede distinguirla. Por eso cada vínculo muestra sus razones.

**En la capa de capacidades.**
- **Funding Track Record** (kind `funding`): proyectos agrupados por instituto NIH o programa NSF, con montos y años.
- **Evidencia:** el título, el resumen y los términos de cada proyecto pasan por los vocabularios con peso ×1,5, y la columna `source` de cada capacidad indica de dónde salió (OpenAlex, NIH RePORTER o NSF Awards).
- **Áreas de financiamiento (inferidas):** las que coinciden con fondos ya recibidos se marcan `validated` ("respaldado por fondos previos").
- **Actividad:** se añade el indicador `Currently funded`.

**CORS y `servidor.py`.** La aplicación intenta primero la conexión directa. Si el navegador la bloquea y la página se abrió desde `servidor.py`, usa `/proxy/nih` y `/proxy/nsf`. El servidor:
- escucha solo en 127.0.0.1;
- reenvía únicamente a esos dos servicios;
- usa solo la biblioteca estándar de Python.

## Mapa por recinto (js/map.js)

- **Mapa:** Leaflet + OpenStreetMap, con una burbuja por recinto (coordenadas aproximadas en `CAMPUS_GEO`). El tamaño depende de la métrica elegida: profesores (o los que tienen la capacidad filtrada), publicaciones, citas, fondos NIH+NSF o investigadores activos.
- **Líneas:** coautorías entre recintos según OpenAlex.
- **Panel del recinto:** indicadores, capacidades principales por categoría, investigadores más citados y colaboraciones.
- **Matriz:** capacidades × recintos, con clic en cada celda para ver los investigadores.
- **Sin Internet:** se dibuja un esquema SVG equivalente.

## Interfaz (aplicación de una sola página)

| Archivo | Función |
|---|---|
| `index.html` | Portada, pantalla de acceso, aplicación con menú lateral y área de administración |
| `css/app.css` | Diseño (azul marino y dorado, tarjetas, modo oscuro, versión para teléfono) sobre `css/styles.css` |
| `js/views.js` | Enrutador (`#/inicio`, `#/investigadores`, `#/investigador/ORCID/tab`, `#/capacidades`, `#/proyectos`, `#/colaboraciones`, `#/oportunidades`, `#/analitica`, `#/recintos`, `#/buscar?q=`, `#/admin`) y páginas |
| `js/charts.js` | Gráficas SVG sin dependencias, con información al pasar el cursor y vista de tabla. La paleta está validada para daltonismo |
| `js/store.js` | `STORE`: guardado automático tras cada etapa del harvest (IndexedDB). `AUTH`: acceso de consulta y de administración |

**Acceso.** Hay dos niveles: consulta (contraseña genérica) y administración (usuario y contraseña). En modo local (`APP_CONFIG.backend = "local"`) **no hay verificación real**, y la pantalla lo advierte. Las contraseñas **no se escriben en el código**; se configurarán en Supabase (siguiente fase), donde se verifican en el servidor.

**Foto de portada.** Coloca una imagen en `img/hero.jpg` y se mostrará en lugar de la ilustración.
