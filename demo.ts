
import { promises as fs } from "node:fs";
import {
  oc_validar,
  oc_crear,
} from "./src/tools/oc.js";

async function main(): Promise<void> {
  await fs.rm("out", { recursive: true, force: true });
  await fs.mkdir("out/sap", { recursive: true });

  for (const id of [
    "sol-001",
    "sol-002",
    "sol-003",
    "sol-004",
    "sol-005",
    "sol-006",
  ]) {
    console.log(`\n--- ${id} ---`);

    try {
      const { validacion } = await oc_validar(id);

      console.log("Apta:", validacion.apta);
      console.log("Bloqueos:", validacion.bloqueos);
      console.log("Confirmaciones:", validacion.confirmaciones);
      console.log("Retroactiva:", validacion.retroactiva);

      const resultado = await oc_crear(id);
      console.log("Resultado:", resultado);

      if (id === "sol-001" && resultado.resultado === "creada") {
        const segundoIntento = await oc_crear(id);
        console.log("Segundo intento (idempotencia):", segundoIntento);
      }

      if (id === "sol-004" && resultado.resultado === "pendiente_confirmacion") {
        const confirmado = await oc_crear(
          id,
          true,
          "usuario-demo",
        );
        console.log("Después de confirmar:", confirmado);
      }
    } catch (error) {
      console.error(
        "ERROR:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}

main().catch(console.error);
