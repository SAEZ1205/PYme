import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const frontendRoot = resolve(projectRoot, "frontend");
const backendRoot = resolve(projectRoot, "backend");

const serverEntry = resolve(
  backendRoot,
  "server",
  "index.mjs",
);
const viteEntry = resolve(
  frontendRoot,
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);

for (const requiredFile of [serverEntry, viteEntry]) {
  if (!existsSync(requiredFile)) {
    console.error(
      `No se encontró el archivo requerido: ${requiredFile}`,
    );
    console.error(
      "Ejecuta la instalación de dependencias y vuelve a abrir MYPE Voz.",
    );
    process.exit(1);
  }
}

const children = [];
let stopping = false;

function startNodeProcess(label, args, workingDirectory) {
  const child = spawn(process.execPath, args, {
    cwd: workingDirectory,
    stdio: "inherit",
    windowsHide: false,
  });

  child.on("error", (error) => {
    console.error(`No se pudo iniciar ${label}:`, error);
    stop(1);
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;

    if (code !== 0) {
      console.error(
        `${label} se detuvo con código ${
          code ?? "desconocido"
        }${
          signal ? ` y señal ${signal}` : ""
        }.`,
      );
      stop(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        // El proceso ya pudo haberse cerrado.
      }
    }
  }

  setTimeout(() => process.exit(code), 150);
}

console.log("Iniciando backend de IA...");
startNodeProcess(
  "Backend de IA",
  ["--watch", serverEntry],
  backendRoot,
);

console.log("Iniciando frontend web...");
startNodeProcess(
  "Frontend web",
  [
    viteEntry,
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
  ],
  frontendRoot,
);

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        // Sin acción adicional.
      }
    }
  }
});
