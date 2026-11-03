// Paso de build en Vercel: copia el sitio estático (index.html, css/, js/) a dist/.
// La función api/proxy.js la publica Vercel aparte.
import { cpSync, mkdirSync, rmSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("index.html", "dist/index.html");
cpSync("css", "dist/css", { recursive: true });
cpSync("js", "dist/js", { recursive: true });
console.log("dist listo");
