const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "public", "manifest.webmanifest");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.display !== "standalone") {
  throw new Error("O manifesto deve usar display standalone.");
}

if (!manifest.start_url || !manifest.scope) {
  throw new Error("O manifesto precisa de start_url e scope.");
}

for (const icon of manifest.icons || []) {
  const iconPath = path.join(root, "public", icon.src.replace(/^\//, ""));

  if (!fs.existsSync(iconPath) || fs.statSync(iconPath).size === 0) {
    throw new Error(`Ícone ausente ou vazio: ${icon.src}`);
  }
}

const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

if (!index.includes('rel="manifest"')) {
  throw new Error("O index.html não referencia o manifesto.");
}

console.log("PWA: manifesto e recursos validados.");
