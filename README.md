# UPR Research Capacity Map

Quién sabe qué, quién trabaja en qué, qué capacidades tenemos, dónde están y quién podría colaborar.

- **Fuentes:** ORCID (identidad), OpenAlex (producción), NIH RePORTER y NSF Awards (financiamiento), Grants.gov (convocatorias).
- **Base de datos:** Supabase (sesiones y datos publicados; tablas cerradas, acceso solo con sesión válida).
- **Alojamiento:** Vercel (sitio estático + `api/proxy.js` hacia NIH, NSF y Grants.gov).
- **Uso local sin servidor:** abrir `index.html?local=1`; para NIH/NSF/Grants.gov ejecutar `python3 servidor.py`.

Arquitectura y reglas de inferencia: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
