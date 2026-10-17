# Conocimiento del proceso: órdenes de compra

## Objetivo

Preparar y crear órdenes de compra a partir de los fixtures del reto, aplicando controles de negocio antes de registrar la orden en el SAP simulado.

## Fuentes de información

- Solicitud: identificación, proveedor, descripción, centro de costo, subárea, cantidad, precio, valor total, moneda y fecha.
- Cotización: proveedor, NIT, total, moneda y vigencia.
- Aprobación: remitente, fecha, asunto y contenido.
- Factura: número, fecha y total, cuando exista.
- Maestros: proveedores, centros de costo, aprobadores, indicadores de IVA y condiciones de pago.

Los datos de negocio deben obtenerse de estas fuentes y de las herramientas. El modelo no debe inventar ni modificar valores para hacer que una operación pase los controles.

## Controles obligatorios

- **RC1 — Proveedor:** debe existir en el maestro y estar activo.
- **RC2 — Aprobación:** debe existir, contener la palabra «Aprobado» y proceder de un aprobador autorizado para el centro de costo.
- **RC3 — Tope de aprobación:** el total no puede superar el límite autorizado al aprobador.
- **RC4 — Subárea:** debe pertenecer al centro de costo indicado.
- **RC5 — Cotización:** una diferencia superior al 2 % respecto de la solicitud, o la ausencia de cotización, requiere confirmación humana.
- **RC6 — IVA:** si falta el indicador, se deriva del proveedor y se solicita confirmación.
- **RC7 — Condiciones de pago:** si faltan, se derivan del proveedor y se informa al usuario.
- **RC8 — Compra retroactiva:** si la fecha de factura es anterior a la fecha de solicitud, se marca como retroactiva y se solicita confirmación.
- **RC9 — Fecha de aprobación:** si es anterior a la solicitud, se requiere confirmación.
- **RC10 — Consistencia del importe:** cantidad por precio unitario debe coincidir con el total, con una tolerancia de una unidad monetaria.

## Política de creación

1. Leer y normalizar el paquete de la solicitud.
2. Validar los datos contra los maestros y las reglas de negocio.
3. Bloquear la creación si existen controles incumplidos.
4. Solicitar confirmación humana para las excepciones que lo requieren.
5. Construir la orden con los datos validados y derivados.
6. Registrar la orden en el SAP simulado y conservar la evidencia y el registro de control.
7. Garantizar idempotencia: repetir la creación de una misma solicitud no debe generar otra orden.

## Tratamiento de excepciones

Las excepciones no deben resolverse alterando los datos de origen. El agente explica el control incumplido, identifica la información relevante y recomienda la acción siguiente. Una confirmación humana permite continuar únicamente cuando la regla correspondiente admite esa excepción.

## Compras retroactivas

Una orden es retroactiva cuando la factura tiene fecha anterior a la fecha de solicitud. El caso debe quedar identificado en el registro de control para medir la frecuencia del desvío. Como mejora de proceso, se recomienda generar la solicitud y obtener la cotización antes de comprometer la compra, manteniendo un procedimiento de excepción auditable cuando sea necesario.