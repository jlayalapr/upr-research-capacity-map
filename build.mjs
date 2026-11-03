// Paso de build en Vercel: copia el sitio estático (index.html, css/, js/) a dist/.
// Añade ?v=<commit> a los CSS/JS locales para que cada despliegue obligue al navegador a bajar el código nuevo.
// La función api/proxy.js la publica Vercel aparte.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
const v = (process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())).slice(0, 10);
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("css", "dist/css", { recursive: true });
cpSync("js", "dist/js", { recursive: true });
const html = readFileSync("index.html", "utf8").replace(/((?:src|href)="(?:js|css)\/[^"?]+)"/g, `$1?v=${v}"`);
writeFileSync("dist/index.html", html);
console.log("dist listo, versión", v);
