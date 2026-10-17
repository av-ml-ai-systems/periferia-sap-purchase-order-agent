import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { OrdenCompra, SapAdapter } from "./adapter.js";

type Proveedor = {
  nit: string;
  codigo_sap: string;
  activo: boolean;
};

type OrdenRegistrada = {
  numero_oc: string;
  fecha: string;
  solicitud_id?: string;
  payload: OrdenCompra;
};

const ROOT = process.cwd();
const PROVEEDORES_PATH = path.join(
  ROOT,
  "fixtures",
  "reto-03",
  "maestros",
  "proveedores.json",
);
const ORDENES_PATH = path.join(ROOT, "out", "sap", "ordenes.jsonl");

async function leerProveedores(): Promise<Proveedor[]> {
  const contenido = await readFile(PROVEEDORES_PATH, "utf8");
  const datos: unknown = JSON.parse(contenido);

  if (Array.isArray(datos)) {
    return datos as Proveedor[];
  }

  if (
    typeof datos === "object" &&
    datos !== null &&
    "proveedores" in datos &&
    Array.isArray(datos.proveedores)
  ) {
    return datos.proveedores as Proveedor[];
  }

  throw new Error(
    "El maestro de proveedores tiene una estructura no reconocida.",
  );
}

async function leerOrdenes(): Promise<OrdenRegistrada[]> {
  try {
    const contenido = await readFile(ORDENES_PATH, "utf8");

    return contenido
      .split(/\r?\n/)
      .filter((linea) => linea.trim().length > 0)
      .map((linea) => JSON.parse(linea) as OrdenRegistrada);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

export class MockSapAdapter implements SapAdapter {
  async consultarProveedor(
    nit: string,
  ): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const proveedores = await leerProveedores();
    const nitNormalizado = nit.replace(/\D/g, "");

    const proveedor = proveedores.find(
      (item) => item.nit.replace(/\D/g, "") === nitNormalizado,
    );

    if (!proveedor) {
      return null;
    }

    return {
      codigo_sap: proveedor.codigo_sap,
      activo: proveedor.activo,
    };
  }

  async crearOrden(
    orden: OrdenCompra,
  ): Promise<{ numero_oc: string; fecha: string }> {
    const existente = await this.buscarOrdenPorReferencia(
      orden.referencia.solicitud_id,
    );

    if (existente) {
      return existente;
    }

    const ordenes = await leerOrdenes();
    const numero_oc = String(4500000001 + ordenes.length);
    const fecha = new Date().toISOString();

    const registro: OrdenRegistrada = {
      numero_oc,
      fecha,
      solicitud_id: orden.referencia.solicitud_id,
      payload: orden,
    };

    await mkdir(path.dirname(ORDENES_PATH), { recursive: true });
    await appendFile(ORDENES_PATH, `${JSON.stringify(registro)}\n`, "utf8");

    return { numero_oc, fecha };
  }

  async buscarOrdenPorReferencia(
    solicitud_id: string,
  ): Promise<{ numero_oc: string; fecha: string } | null> {
    const ordenes = await leerOrdenes();

    const existente = ordenes.find(
      (registro) =>
        registro.solicitud_id === solicitud_id ||
        registro.payload?.referencia?.solicitud_id === solicitud_id,
    );

    if (!existente) {
      return null;
    }

    return {
      numero_oc: existente.numero_oc,
      fecha: existente.fecha,
    };
  }
}