import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, "fixtures", "reto-03");
const OUT = path.join(ROOT, "out");

type Solicitud = {
  solicitud_id: string;
  solicitante: string;
  proveedor_nombre: string;
  proveedor_nit?: string;
  descripcion: string;
  centro_costo: string;
  subarea: string;
  cantidad: number;
  valor_unitario: number;
  valor_total: number;
  moneda: "COP" | "USD";
  indicador_iva?: string;
  condiciones_pago?: string;
  fecha_solicitud: string;
};

type Paquete = {
  correo: Record<string, unknown> | null;
  solicitud: Solicitud | null;
  cotizacion: string | null;
  aprobacion: Record<string, unknown> | null;
  factura: string | null;
  faltantes: string[];
};

type Validacion = {
  apta: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  derivados: Record<string, string>;
  retroactiva: boolean;
};

async function texto(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function json<T>(file: string): Promise<T | null> {
  const content = await texto(file);

  if (content === null) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function maestro<T>(name: string): Promise<T[]> {
  return (
    (await json<T[]>(path.join(FIXTURES, "maestros", name))) ?? []
  );
}

function normalizar(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function fechaEn(text: string | null): string | null {
  return text?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
}

function totalCotizacion(text: string | null): number | null {
  if (!text) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  const line = lines.find(
    (item) => /\btotal\b/i.test(item) && !/subtotal/i.test(item),
  );

  if (!line) {
    return null;
  }

  const match = line.match(/(?:COP\s*)?\$?\s*([\d.]+(?:,\d{1,2})?)/i);

  if (!match?.[1]) {
    return null;
  }

  const value = Number(
    match[1].replace(/\./g, "").replace(",", "."),
  );

  return Number.isFinite(value) ? value : null;
}

export async function oc_leer_paquete(
  caseId: string,
): Promise<Paquete> {
  if (!/^sol-00[1-6]$/.test(caseId)) {
    throw new Error("Caso inválido. Usa sol-001 a sol-006.");
  }

  const folder = path.join(FIXTURES, "solicitudes", caseId);

  const [correo, solicitud, cotizacion, aprobacion, factura] =
    await Promise.all([
      json<Record<string, unknown>>(path.join(folder, "correo.json")),
      json<Solicitud>(path.join(folder, "solicitud.json")),
      texto(path.join(folder, "cotizacion.txt")),
      json<Record<string, unknown>>(path.join(folder, "aprobacion.json")),
      texto(path.join(folder, "factura.txt")),
    ]);

  const faltantes = [
    ...(!correo ? ["correo.json"] : []),
    ...(!solicitud ? ["solicitud.json"] : []),
    ...(!cotizacion ? ["cotizacion.txt"] : []),
    ...(!aprobacion ? ["aprobacion.json"] : []),
  ];

  return { correo, solicitud, cotizacion, aprobacion, factura, faltantes };
}

export async function oc_validar(
  caseId: string,
): Promise<{ paquete: Paquete; validacion: Validacion }> {
  const paquete = await oc_leer_paquete(caseId);
  const bloqueos: string[] = [];
  const confirmaciones: string[] = [];
  const derivados: Record<string, string> = {};
  let retroactiva = false;

  const solicitud = paquete.solicitud;

  if (!solicitud) {
    bloqueos.push("No se pudo leer solicitud.json.");

    return {
      paquete,
      validacion: {
        apta: false,
        bloqueos,
        confirmaciones,
        derivados,
        retroactiva,
      },
    };
  }

  if (paquete.faltantes.length > 0) {
    bloqueos.push(
      `Paquete incompleto: ${paquete.faltantes.join(", ")}`,
    );
  }

  const [proveedores, centros] = await Promise.all([
    maestro<{
      codigo_sap: string;
      nit: string;
      nombre: string;
      condiciones_pago_default: string;
      indicador_iva_default: string;
      activo: boolean;
    }>("proveedores.json"),
    maestro<{
      centro_costo: string;
      subareas: string[];
      aprobadores: { email: string; tope: number }[];
    }>("centros-costo.json"),
  ]);

  const proveedor = proveedores.find((item) =>
    solicitud.proveedor_nit
      ? item.nit.replace(/\D/g, "") ===
        solicitud.proveedor_nit!.replace(/\D/g, "")
      : normalizar(item.nombre) ===
        normalizar(solicitud.proveedor_nombre),
  );

  if (!proveedor) {
    bloqueos.push("RC1: proveedor inexistente en el maestro.");
  } else if (!proveedor.activo) {
    bloqueos.push("RC1: proveedor inactivo.");
  }

  const centro = centros.find(
    (item) => item.centro_costo === solicitud.centro_costo,
  );

  if (!centro) {
    bloqueos.push("RC4: centro de costo inexistente.");
  } else if (!centro.subareas.includes(solicitud.subarea)) {
    bloqueos.push("RC4: subárea no válida para el centro de costo.");
  }

  const aprobacion = paquete.aprobacion;
  const email =
    typeof aprobacion?.de === "string" ? aprobacion.de : "";
  const cuerpo =
    typeof aprobacion?.cuerpo === "string" ? aprobacion.cuerpo : "";
  const fechaAprobacion =
    typeof aprobacion?.fecha === "string"
      ? aprobacion.fecha.slice(0, 10)
      : null;

  const aprobador = centro?.aprobadores.find(
    (item) => item.email.toLowerCase() === email.toLowerCase(),
  );

  if (!aprobacion || !/aprobado/i.test(cuerpo) || !aprobador) {
    bloqueos.push(
      "RC2: falta aprobación válida de un aprobador autorizado.",
    );
  }

  // RC3: comprobar el tope incluso si quien aprobó no está autorizado.
  const topeAplicable =
    aprobador?.tope ??
    (centro && centro.aprobadores.length > 0
      ? Math.max(...centro.aprobadores.map((item) => item.tope))
      : undefined);

  if (
    topeAplicable !== undefined &&
    solicitud.valor_total > topeAplicable
  ) {
    bloqueos.push(
      `RC3: el total ${solicitud.valor_total} supera el tope aplicable ${topeAplicable}.`,
    );
  }

  if (
    !Number.isFinite(solicitud.cantidad) ||
    !Number.isFinite(solicitud.valor_unitario) ||
    !Number.isFinite(solicitud.valor_total)
  ) {
    bloqueos.push("RC10: existen valores numéricos inválidos.");
  } else if (
    Math.abs(
      solicitud.cantidad * solicitud.valor_unitario -
        solicitud.valor_total,
    ) > 1
  ) {
    bloqueos.push(
      "RC10: cantidad por valor unitario no coincide con el total.",
    );
  }

  const totalCotizado = totalCotizacion(paquete.cotizacion);

  if (totalCotizado === null) {
    confirmaciones.push(
      "RC5: no se pudo identificar el total de la cotización; confirma el importe.",
    );
  } else {
    const diferencia =
      Math.abs(totalCotizado - solicitud.valor_total) /
      Math.max(solicitud.valor_total, 1);

    if (diferencia > 0.02) {
      confirmaciones.push(
        `RC5: solicitud ${solicitud.valor_total}; cotización ${totalCotizado}; diferencia ${(diferencia * 100).toFixed(2)}%. ¿Confirmas continuar?`,
      );
    }
  }

  if (!solicitud.indicador_iva) {
    if (proveedor) {
      derivados.indicador_iva = proveedor.indicador_iva_default;
      confirmaciones.push(
        `RC6: indicador IVA derivado ${proveedor.indicador_iva_default}. ¿Confirmas?`,
      );
    } else {
      bloqueos.push("RC6: no se puede derivar el indicador IVA.");
    }
  }

  if (!solicitud.condiciones_pago) {
    if (proveedor) {
      derivados.condiciones_pago =
        proveedor.condiciones_pago_default;
    } else {
      bloqueos.push("RC7: no se pueden derivar las condiciones de pago.");
    }
  }

  const fechaFactura = fechaEn(paquete.factura);

  if (fechaFactura && fechaFactura < solicitud.fecha_solicitud) {
    retroactiva = true;
    confirmaciones.push(
      `RC8: factura ${fechaFactura} anterior a la solicitud ${solicitud.fecha_solicitud}. ¿Confirmas continuar?`,
    );
  }

  if (
    fechaAprobacion &&
    fechaAprobacion < solicitud.fecha_solicitud
  ) {
    confirmaciones.push(
      `RC9: aprobación ${fechaAprobacion} anterior a la solicitud ${solicitud.fecha_solicitud}. ¿Confirmas continuar?`,
    );
  }

  return {
    paquete,
    validacion: {
      apta: bloqueos.length === 0,
      bloqueos,
      confirmaciones,
      derivados,
      retroactiva,
    },
  };
}

export async function oc_generar_evidencia(caseId: string) {
  const paquete = await oc_leer_paquete(caseId);
  const approval = paquete.aprobacion ?? {};

  const contenido = [
    `De: ${String(approval.de ?? "No disponible")}`,
    `Para: ${String(approval.para ?? "No disponible")}`,
    `Fecha: ${String(approval.fecha ?? "No disponible")}`,
    `Asunto: ${String(approval.asunto ?? "Aprobación de compra")}`,
    "",
    String(approval.cuerpo ?? "Sin contenido de aprobación."),
  ].join("\n");

  const sha256 = createHash("sha256")
    .update(contenido, "utf8")
    .digest("hex");

  const destino = path.join(OUT, caseId, "aprobacion.txt");
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(
    destino,
    `${contenido}\n\nSHA-256: ${sha256}\n`,
    "utf8",
  );

  return { path: destino, sha256 };
}

export async function oc_construir_payload(caseId: string) {
  const { paquete, validacion } = await oc_validar(caseId);
  const solicitud = paquete.solicitud;

  if (!solicitud) {
    throw new Error("No se puede construir la OC sin solicitud.");
  }

  if (validacion.bloqueos.length > 0) {
    throw new Error(
      `Solicitud bloqueada: ${validacion.bloqueos.join(" ")}`,
    );
  }

  const proveedores = await maestro<{
    codigo_sap: string;
    nit: string;
    nombre: string;
  }>("proveedores.json");

  const proveedor = proveedores.find((item) =>
    solicitud.proveedor_nit
      ? item.nit.replace(/\D/g, "") ===
        solicitud.proveedor_nit!.replace(/\D/g, "")
      : normalizar(item.nombre) ===
        normalizar(solicitud.proveedor_nombre),
  );

  if (!proveedor) {
    throw new Error("Proveedor no encontrado.");
  }

  const evidencia = await oc_generar_evidencia(caseId);

  const payload = {
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: String(paquete.correo?.id ?? caseId),
      cotizacion_ref: paquete.cotizacion
        ? `${caseId}/cotizacion.txt`
        : null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: proveedor.codigo_sap,
      nit: proveedor.nit,
      nombre: proveedor.nombre,
    },
    moneda: solicitud.moneda,
    condiciones_pago:
      solicitud.condiciones_pago ??
      validacion.derivados.condiciones_pago,
    aprobador: {
      email: String(paquete.aprobacion?.de ?? ""),
      fecha_aprobacion: String(paquete.aprobacion?.fecha ?? ""),
      evidencia_sha256: evidencia.sha256,
    },
    posiciones: [
      {
        numero: 10,
        descripcion: solicitud.descripcion.slice(0, 40),
        cantidad: solicitud.cantidad,
        unidad: "UN",
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva:
          solicitud.indicador_iva ??
          validacion.derivados.indicador_iva,
      },
    ],
    excepciones: validacion.confirmaciones.map((detalle) => ({
      codigo: detalle.slice(0, 3),
      detalle,
      confirmado_por: null as string | null,
    })),
  };

  const destino = path.join(OUT, caseId, "trazabilidad.json");
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(
    destino,
    JSON.stringify(
      {
        payload,
        fuentes: {
          solicitud: "solicitud.json",
          proveedor: "maestros/proveedores.json",
          aprobacion: "aprobacion.json",
          derivados: validacion.derivados,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return { payload, validacion };
}

async function registrarControl(
  solicitudId: string,
  resultado: string,
  numeroOC: string,
  validacion: Validacion,
): Promise<void> {
  const file = path.join(OUT, "control.csv");
  await fs.mkdir(path.dirname(file), { recursive: true });

  if (!(await texto(file))) {
    await fs.writeFile(
      file,
      "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n",
      "utf8",
    );
  }

  const csv = (value: string) =>
    `"${value.replace(/"/g, '""')}"`;

  const row = [
    solicitudId,
    resultado,
    numeroOC,
    String(validacion.retroactiva),
    validacion.bloqueos.join(" | "),
    validacion.confirmaciones.join(" | "),
    new Date().toISOString(),
  ]
    .map(csv)
    .join(",");

  await fs.appendFile(file, `${row}\n`, "utf8");
}

export async function oc_crear(
  caseId: string,
  confirmado = false,
  confirmadoPor = "usuario",
) {
  const { paquete, validacion } = await oc_validar(caseId);
  const solicitud = paquete.solicitud;

  if (!solicitud) {
    return { resultado: "bloqueada", motivo: "Solicitud inválida." };
  }

  if (validacion.bloqueos.length > 0) {
    await registrarControl(
      solicitud.solicitud_id,
      "bloqueada",
      "",
      validacion,
    );

    return {
      resultado: "bloqueada",
      bloqueos: validacion.bloqueos,
    };
  }

  if (validacion.confirmaciones.length > 0 && !confirmado) {
    await registrarControl(
      solicitud.solicitud_id,
      "pendiente_confirmacion",
      "",
      validacion,
    );

    return {
      resultado: "pendiente_confirmacion",
      confirmaciones: validacion.confirmaciones,
    };
  }

  const sapFile = path.join(OUT, "sap", "ordenes.jsonl");
  await fs.mkdir(path.dirname(sapFile), { recursive: true });

  const lines = (await texto(sapFile) ?? "")
    .split(/\r?\n/)
    .filter(Boolean);

  for (const line of lines) {
    try {
      const order = JSON.parse(line) as {
        solicitud_id?: string;
        numero_oc?: string;
      };

      if (order.solicitud_id === solicitud.solicitud_id) {
        return {
          resultado: "creada",
          numero_oc: order.numero_oc,
          idempotente: true,
        };
      }
    } catch {
      // Ignora registros históricos malformados.
    }
  }

  const { payload } = await oc_construir_payload(caseId);
  const numeroOC = String(4500000001 + lines.length);

  const order = {
    numero_oc: numeroOC,
    solicitud_id: solicitud.solicitud_id,
    fecha: new Date().toISOString(),
    retroactiva: validacion.retroactiva,
    payload: {
      ...payload,
      excepciones: payload.excepciones.map((item) => ({
        ...item,
        confirmado_por: confirmado ? confirmadoPor : null,
      })),
    },
  };

  await fs.appendFile(
    sapFile,
    `${JSON.stringify(order)}\n`,
    "utf8",
  );

  await registrarControl(
    solicitud.solicitud_id,
    "creada",
    numeroOC,
    validacion,
  );

  return {
    resultado: "creada",
    numero_oc: numeroOC,
    retroactiva: validacion.retroactiva,
  };
}