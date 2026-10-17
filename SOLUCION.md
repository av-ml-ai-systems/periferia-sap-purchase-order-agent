# Reto 3 — Agente conversacional para órdenes de compra SAP

## 1. Resumen ejecutivo

Se implementó un prototipo de agente conversacional para revisar solicitudes de compra, ejecutar controles de negocio, solicitar confirmación humana cuando corresponde y simular la creación de órdenes de compra (OC).

La solución combina una interfaz web de chat, un agente que utiliza un modelo de lenguaje local y herramientas deterministas para validar los datos y gestionar la creación simulada.

**Alcance actual:** las órdenes se simulan mediante archivos locales. No se ejecutan transacciones en un sistema SAP real.

## 2. Arquitectura de la solución

### 2.1 Componentes

- **`public/`:** interfaz web para interactuar con el agente.
- **`src/server.ts`:** servidor HTTP y endpoints de la aplicación.
- **`src/agent/agent.ts`:** lógica de interacción del agente, selección de herramientas y gestión de confirmaciones.
- **`src/agent/audit.ts`:** registro de eventos de auditoría.
- **`src/llm/ollama.ts`:** comunicación con el modelo local mediante Ollama.
- **`src/tools/oc.ts`:** lectura del paquete documental, validaciones, construcción del payload, generación de evidencia y simulación de creación.
- **`agent/prompt.md`:** instrucciones del agente separadas del código.
- **`fixtures/reto-03/`:** solicitudes de prueba y maestros de proveedores y centros de costo.
- **`demo.ts`:** demostración determinista de los seis casos, sin depender del modelo de lenguaje.
- **`out/`:** evidencias, trazabilidad, registros de órdenes y auditoría.

### 2.2 Ciclo de ejecución del agente

1. El usuario solicita revisar una solicitud mediante el chat.
2. El agente identifica el caso y ejecuta las herramientas correspondientes.
3. Las herramientas leen los documentos y consultan los datos maestros locales.
4. Se ejecutan los controles de negocio mediante código determinista.
5. Si existen bloqueos, se informa al usuario y se impide crear la orden.
6. Si se requiere confirmación, la operación queda pendiente.
7. Cuando se autoriza continuar, se construye el payload, se genera evidencia y se registra la orden simulada.
8. El resultado queda registrado para facilitar su trazabilidad y auditoría.

Las validaciones críticas se ejecutan en código determinista y no se delegan exclusivamente al modelo de lenguaje.

## 3. Herramientas y responsabilidades

Las operaciones principales se implementan en `src/tools/oc.ts`.

| Herramienta | Responsabilidad |
|---|---|
| `oc_leer_paquete` | Lee los documentos asociados a una solicitud e identifica archivos faltantes. |
| `oc_validar` | Ejecuta los controles y devuelve bloqueos, confirmaciones, valores derivados y condición retroactiva. |
| `oc_construir_payload` | Prepara la estructura de la orden de compra y registra la trazabilidad de sus fuentes. |
| `oc_generar_evidencia` | Genera evidencia textual de la aprobación y calcula su hash SHA-256. |
| `oc_crear` | Comprueba bloqueos y confirmaciones, aplica idempotencia básica y registra la orden simulada. |

### 3.1 Contrato de las herramientas

Las funciones devuelven resultados estructurados para que el agente pueda comunicar el estado de la operación.

Como mejora pendiente, se recomienda estandarizar todas las herramientas con un contrato común, por ejemplo `{ ok, data, error }`, y validar sus entradas y salidas mediante esquemas como Zod.

## 4. Matriz de controles de negocio RC1–RC10

| Control | Regla | Comportamiento implementado |
|---|---|---|
| RC1 | Proveedor existente y activo | Bloquea proveedores inexistentes o inactivos. Busca por NIT cuando está disponible; de lo contrario, normaliza el nombre. |
| RC2 | Aprobación válida | Bloquea si no existe una aprobación reconocible, si no contiene la expresión de aprobación o si el remitente no está autorizado para el centro de costo. |
| RC3 | Límite de aprobación | Bloquea importes superiores al tope aplicable. |
| RC4 | Centro de costo y subárea | Bloquea centros inexistentes o subáreas no asociadas al centro. |
| RC5 | Diferencia entre solicitud y cotización | Solicita confirmación cuando la diferencia supera el 2 % o no se identifica el total de la cotización. |
| RC6 | Indicador de IVA | Deriva el valor predeterminado del proveedor y solicita confirmación. Si no puede derivarlo, bloquea. |
| RC7 | Condiciones de pago | Deriva las condiciones predeterminadas del proveedor. No requiere confirmación independiente. |
| RC8 | Compra retroactiva | Detecta una factura anterior a la fecha de solicitud, marca la operación como retroactiva y solicita confirmación. |
| RC9 | Fecha de aprobación | Solicita confirmación cuando la fecha de aprobación es anterior a la fecha de solicitud. |
| RC10 | Consistencia del importe | Bloquea si la cantidad por el precio unitario difiere del total en más de una unidad monetaria o si los valores no son numéricos válidos. |

### 4.1 Consideraciones de control

- Los bloqueos impiden la creación incluso si el usuario intenta confirmar.
- Las confirmaciones representan excepciones que requieren intervención humana.
- Los valores derivados se obtienen de los maestros locales de prueba.
- Los documentos se procesan mediante lógica básica; no se pretende sustituir una solución empresarial de extracción y validación documental.
- En producción, las fechas, importes, autorizaciones y maestros deben validarse contra fuentes oficiales.

## 5. Demostración de los seis casos

La demostración se ejecuta mediante `npm run demo` y no depende del modelo de lenguaje.

| Caso | Escenario | Resultado observado |
|---|---|---|
| `sol-001` | Solicitud válida | Se crea la OC `4500000001`. El segundo intento devuelve el mismo número, demostrando idempotencia básica. |
| `sol-002` | Proveedor inexistente | Operación bloqueada por RC1. |
| `sol-003` | Aprobación no válida e importe superior al tope | Operación bloqueada por RC2 y RC3. |
| `sol-004` | Diferencia del 6 % entre solicitud y cotización | Se solicita confirmación. Después de confirmarla, se crea la OC `4500000002`. |
| `sol-005` | Factura anterior a la solicitud | Se detecta la condición retroactiva y la operación queda pendiente de confirmación. |
| `sol-006` | Indicador de IVA ausente | Se deriva el indicador predeterminado y se solicita confirmación. |

### 5.1 Interpretación de los resultados

Los seis casos permiten demostrar diferentes resultados del flujo: creación, bloqueo, confirmación, detección de retroactividad y derivación de datos.

La demostración valida el comportamiento del prototipo sobre los fixtures disponibles. No representa una certificación del comportamiento de una integración SAP real.

## 6. Evidencias y trazabilidad

El prototipo genera los siguientes artefactos locales:

- `out/<caso>/trazabilidad.json`: payload de la OC y referencias a las fuentes utilizadas.
- `out/<caso>/aprobacion.txt`: campos del correo de aprobación y hash SHA-256.
- `out/sap/ordenes.jsonl`: registro de órdenes de compra simuladas.
- `out/control.csv`: resultado, número de OC, indicador retroactivo, bloqueos, confirmaciones y fecha de registro.
- `out/log.jsonl`: eventos de auditoría de las interacciones con herramientas.

### 6.1 Integridad de la evidencia

El hash SHA-256 permite detectar cambios en el contenido exacto utilizado para calcularlo. Sin embargo, no demuestra por sí solo la autenticidad del correo original ni garantiza que la evidencia se conserve inmutable.

En producción, se recomienda utilizar almacenamiento protegido, controles de acceso, políticas de retención y mecanismos de auditoría que permitan verificar quién generó o consultó cada evidencia.

### 6.2 Idempotencia

La implementación busca órdenes previas por `solicitud_id` antes de crear una nueva orden.

Esto permite demostrar idempotencia en la ejecución local secuencial. No ofrece garantías transaccionales frente a solicitudes concurrentes, fallos parciales o múltiples instancias de la aplicación.

## 7. Diseño propuesto para una integración real con SAP

### 7.1 Estado actual

La creación de órdenes está simulada mediante archivos locales. No hay conexión activa con SAP, credenciales empresariales ni confirmación de transacciones en un sistema real.

### 7.2 Arquitectura recomendada

Se propone aislar la lógica de negocio detrás de una interfaz `SapAdapter`, con operaciones para crear y consultar órdenes de compra.

Esta separación permitiría mantener las herramientas de negocio y las pruebas independientes de la tecnología concreta de integración.

### 7.3 Alternativa de integración

Como primera opción se evaluaría la API OData estándar `API_PURCHASEORDER_PROCESS_SRV`, sujeta a la versión de SAP, los servicios habilitados y la configuración del cliente.

El flujo propuesto sería:

1. Validar la solicitud y las autorizaciones.
2. Transformar el payload interno al esquema requerido por SAP.
3. Autenticar el servicio mediante credenciales gestionadas de forma segura en el servidor.
4. Enviar la solicitud de creación y gestionar los mecanismos de seguridad requeridos por el servicio.
5. Interpretar la respuesta de SAP y recuperar el número de orden de compra.
6. Registrar el identificador de correlación, el resultado y los errores.
7. Ante una respuesta incierta, consultar si la orden ya existe antes de reintentar.

El mapeo definitivo debe comprobarse contra el esquema real de la instalación SAP. Sociedad, organización de compras, proveedor, moneda, condiciones de pago, posiciones, centro de costo e impuestos deben corresponder a los campos y catálogos configurados en el sistema destino.

### 7.4 Alternativas

- **RFC/BAPI:** opción para organizaciones con interfaces RFC aprobadas y la infraestructura necesaria.
- **SAP Integration Suite:** alternativa para centralizar integración, transformación, seguridad y monitoreo.
- **Archivo de intercambio:** posible solución temporal cuando no existe una API habilitada, con revisión y carga controladas por un operador.

Estas alternativas son propuestas de diseño. Ninguna integración real está habilitada en el prototipo entregado.

## 8. Análisis del proceso de compra retroactiva

Una compra retroactiva ocurre cuando la documentación refleja una factura o un compromiso anterior a la solicitud registrada.

El prototipo compara la fecha de la factura con la fecha de solicitud. Si la factura es anterior, establece `retroactiva: true` y solicita confirmación.

### 8.1 Controles recomendados para producción

La confirmación del usuario no debe interpretarse automáticamente como autorización para regularizar una compra. Se recomienda:

- Identificar quién solicitó y quién autorizó la compra.
- Verificar la factura, la recepción del servicio o mercancía y las fechas relevantes.
- Documentar la justificación de la excepción.
- Obtener aprobación del responsable autorizado según las políticas internas.
- Revisar los requisitos financieros, tributarios y de compras.
- Conservar evidencia verificable de la decisión y de sus responsables.
- Registrar la regularización y asegurar la segregación de funciones.

La fecha de factura es una señal para revisión, no una prueba suficiente de todas las circunstancias del proceso retroactivo.

## 9. Decisiones de diseño y trade-offs

### 9.1 Validaciones deterministas y modelo de lenguaje

Las reglas críticas se ejecutan mediante funciones TypeScript. El modelo facilita la interacción en lenguaje natural, pero no debe decidir por sí solo si una operación cumple las políticas.

**Ventaja:** el comportamiento de las reglas es más predecible y comprobable.

**Trade-off:** el flujo determinista requiere ampliar el código cuando aparecen nuevas reglas o excepciones.

### 9.2 Modelo local con Ollama

Se utiliza el modelo local `llama3.2:1b`.

**Ventaja:** permite ejecutar la demostración sin depender de una API de modelos de pago.

**Trade-off:** la calidad de interpretación puede ser inferior a la de modelos más capaces y depende de los recursos del equipo.

### 9.3 Persistencia basada en archivos

Las órdenes y la auditoría se almacenan en archivos locales.

**Ventaja:** facilita la instalación, la inspección de resultados y la demostración.

**Trade-off:** no proporciona las garantías transaccionales, la concurrencia, la disponibilidad ni el gobierno de datos de una base de datos empresarial.

### 9.4 Confirmación humana

Las excepciones relevantes requieren confirmación antes de continuar.

**Ventaja:** evita continuar automáticamente ante discrepancias que requieren revisión.

**Trade-off:** agrega intervención al flujo y requiere una identidad autenticada en una implementación productiva.

### 9.5 Simulación de SAP

Se simula la creación para demostrar las reglas sin credenciales ni acceso a una instancia SAP.

**Ventaja:** permite evaluar el flujo localmente.

**Trade-off:** no prueba la compatibilidad con una instalación SAP real.

## 10. Supuestos

- Los seis casos y los maestros suministrados constituyen el conjunto de demostración.
- Los documentos de los casos representan las fuentes disponibles para la validación.
- Los importes y las fechas utilizan los formatos previstos en los fixtures.
- Los centros de costo, proveedores y aprobadores son datos de ejemplo locales.
- El usuario que confirma una excepción se identifica mediante el flujo de simulación; esto no sustituye una identidad autenticada.
- No se dispone de credenciales, conectividad ni autorización para crear órdenes en SAP real.
- Los números de OC generados son identificadores de simulación y no números asignados por SAP.

## 11. Cobertura de historias de usuario HU1–HU6

| Historia | Cobertura | Estado |
|---|---|---|
| HU1 — Lectura y normalización del paquete | Lectura de correo, solicitud, cotización, aprobación y factura; identificación de archivos faltantes. | Parcial: falta estandarizar algunos errores de archivo y validar todos los esquemas. |
| HU2 — Validación de reglas | Devuelve aptitud, bloqueos, confirmaciones, derivados y condición retroactiva. | Implementada para los seis escenarios de demostración. |
| HU3 — Construcción del payload | Construye el payload con datos de solicitud, proveedor, aprobación y valores derivados; registra fuentes. | Implementada en modo local; requiere verificar el esquema SAP real. |
| HU4 — Evidencia de aprobación | Genera texto con campos de aprobación y hash SHA-256. | Implementada; autenticidad y conservación inmutable requieren controles adicionales. |
| HU5 — Creación condicionada e idempotencia | Bloquea solicitudes inválidas, requiere confirmación y simula creación con búsqueda por `solicitud_id`. | Implementada en modo local; sin garantías transaccionales frente a concurrencia. |
| HU6 — Errores legibles y continuidad | La demo informa errores y continúa procesando los casos siguientes. | Parcial: se recomienda uniformar el manejo de excepciones de todas las herramientas. |

## 12. Uso de inteligencia artificial

La solución utiliza un modelo de lenguaje local mediante Ollama para facilitar la interacción conversacional.

Las reglas de negocio, las comparaciones de importes, las búsquedas en maestros y la creación simulada se realizan mediante código determinista. El modelo no tiene autorización para crear órdenes reales ni para anular los bloqueos definidos en las herramientas.

El desarrollo asistido por IA requiere revisión del código y ejecución de pruebas. La responsabilidad de verificar los resultados y garantizar el cumplimiento de los requisitos corresponde al desarrollador.

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación o trabajo pendiente |
|---|---|
| El modelo interpreta incorrectamente una solicitud. | Limitar las acciones mediante herramientas y validar identificadores y argumentos. |
| Un proveedor o aprobador se identifica incorrectamente. | Consultar maestros oficiales y validar autorizaciones en el sistema corporativo. |
| Se crea una orden duplicada. | Implementar una clave idempotente en el backend y restricciones transaccionales. |
| La confirmación no corresponde a un usuario autorizado. | Incorporar autenticación, autorización y registro verificable de identidad. |
| La evidencia se modifica después de calcular el hash. | Utilizar almacenamiento inmutable, controles de acceso y verificación de integridad. |
| Se pierde el estado por reinicio o concurrencia. | Sustituir archivos locales por almacenamiento transaccional. |
| Una integración SAP falla parcialmente. | Gestionar correlación, reintentos seguros, consultas de reconciliación y errores del servicio. |
| El paquete contiene archivos corruptos o datos inesperados. | Aplicar validación de esquemas, mensajes controlados y pruebas negativas adicionales. |
| Se expone información sensible. | Aplicar minimización de datos, control de acceso, gestión segura de secretos y políticas de retención. |

## 14. Limitaciones y siguientes pasos

El prototipo demuestra el flujo conversacional, las reglas principales, las confirmaciones y la generación local de evidencias. No constituye todavía un sistema productivo de compras.

Antes de una puesta en producción se recomienda:

1. Incorporar una interfaz formal `SapAdapter` y una implementación mock independiente.
2. Uniformar los contratos de las herramientas y aplicar esquemas Zod a las entradas y salidas.
3. Ampliar las pruebas unitarias, de integración, concurrencia y recuperación ante fallos.
4. Implementar persistencia transaccional e idempotencia resistente a concurrencia.
5. Incorporar autenticación, autorización y gestión segura de secretos.
6. Validar el payload contra el esquema de la instalación SAP objetivo.
7. Mejorar la extracción y validación de documentos y fechas.
8. Añadir monitoreo, métricas y procedimientos de recuperación.
9. Verificar la interfaz conversacional y las confirmaciones en escenarios adicionales.

## 15. Ejecución local

### 15.1 Requisitos

- Node.js y npm.
- Ollama instalado.
- El modelo `llama3.2:1b` disponible localmente para la aplicación conversacional.

### 15.2 Instalación

Ejecutar desde la raíz del repositorio:

```powershell
npm install
ollama pull llama3.2:1b
```

### 15.3 Iniciar la aplicación

```powershell
npm run dev
```

La aplicación local se sirve en `http://localhost:3000`.

### 15.4 Ejecutar la demostración determinista

```powershell
npm run demo
```

La demostración procesa los seis casos, presenta los bloqueos y confirmaciones, comprueba la idempotencia de `sol-001` y demuestra la confirmación explícita de `sol-004`.

### 15.5 Estado del despliegue

La aplicación se ha ejecutado localmente. No se dispone de un despliegue público operativo ni de una integración con SAP real en esta entrega.