
# Solución técnica — Reto 3
## Agente conversacional de Órdenes de Compra SAP

### 1. Objetivo

Desarrollar un agente conversacional capaz de interpretar solicitudes en lenguaje natural, consultar paquetes de órdenes de compra, ejecutar validaciones de negocio y simular la creación de órdenes, manteniendo trazabilidad de las acciones realizadas.

### 2. Arquitectura propuesta

La solución está construida con TypeScript y Node.js, y utiliza los siguientes componentes:

- **Interfaz web:** permite conversar con el agente, seleccionar casos de prueba y visualizar las acciones ejecutadas.
- **API REST:** expone endpoints para conversar, consultar sesiones y verificar el estado del servicio.
- **Modelo de lenguaje:** Ollama con `llama3.2:1b`, ejecutado localmente, interpreta solicitudes en lenguaje natural.
- **Lógica de negocio:** implementa la lectura de paquetes, validaciones y simulación de creación de órdenes.
- **Datos de prueba:** archivos JSON y TXT con solicitudes, cotizaciones, autorizaciones y maestros.
- **Trazabilidad:** registra las operaciones y genera evidencias locales.

### 3. Flujo de funcionamiento

1. El usuario envía una solicitud desde la interfaz web o mediante la API.
2. El servidor identifica el caso solicitado, utilizando el identificador explícito cuando está disponible o solicitando al modelo que interprete la intención.
3. Se leen los archivos asociados al caso.
4. Se ejecutan las validaciones deterministas de negocio.
5. Si la operación puede continuar, se simula la creación de la orden.
6. Cuando las reglas requieren confirmación, el flujo solicita la intervención del usuario.
7. Se devuelve una respuesta conversacional junto con información sobre las herramientas ejecutadas.

### 4. Validaciones y controles

La lógica de negocio contempla escenarios como:

- Validación de la existencia del proveedor.
- Revisión de centros de costo y condiciones de pago.
- Consulta de indicadores de IVA.
- Comprobación de autorización y límites monetarios.
- Identificación de inconsistencias entre solicitud y cotización.
- Detección de fechas que requieren revisión.
- Confirmación de operaciones cuando las reglas lo exigen.
- Control de idempotencia para reducir el riesgo de crear órdenes duplicadas.
- Registro de evidencias y resultados de ejecución.

Las validaciones se realizan mediante código determinista; el modelo de lenguaje no sustituye las reglas de negocio.

### 5. API

| Método | Endpoint | Propósito |
|---|---|---|
| GET | `/api/health` | Consultar estado, proveedor y modelo |
| POST | `/api/chat` | Procesar mensajes conversacionales |
| GET | `/api/sessions/:id` | Consultar historial de una sesión en memoria |

La solicitud de chat recibe un identificador de sesión y un mensaje. La respuesta incluye el mensaje del agente, las herramientas ejecutadas y el estado de confirmación cuando aplica.

### 6. Ejecución local

Requisitos: Node.js, npm, Ollama y el modelo `llama3.2:1b`.

```powershell
npm install
ollama pull llama3.2:1b
npm run dev
```

La interfaz está disponible en `http://localhost:3000`.

Para comprobar la compilación de TypeScript:

```powershell
npx tsc --noEmit
```

Para ejecutar la demostración:

```powershell
npm run demo
```

### 7. Decisiones técnicas

- **TypeScript:** facilita el mantenimiento y el control de tipos.
- **Express:** permite implementar una API REST ligera.
- **Zod:** permite validar estructuras y datos de entrada en la lógica de negocio.
- **Ollama:** permite ejecutar un modelo local sin depender de una API comercial externa.
- **Validaciones deterministas:** aportan consistencia y reducen la dependencia del modelo para decisiones críticas.
- **Adaptador SAP simulado:** permite demostrar el flujo sin credenciales ni infraestructura SAP.

### 8. Limitaciones conocidas

- No existe conexión con un sistema SAP real.
- La persistencia es local; las sesiones se mantienen en memoria.
- El comportamiento conversacional con LLM está enfocado en interpretar solicitudes y localizar casos. No equivale a un agente autónomo general con un ciclo completo de selección y ejecución de herramientas por parte del modelo.
- Ollama debe estar instalado y activo en el entorno de ejecución.
- La aplicación no está endurecida ni desplegada para un entorno productivo.

### 9. Mejoras futuras

- Integrar un entorno SAP de pruebas mediante un adaptador real y credenciales seguras.
- Incorporar persistencia de sesiones y registros en una base de datos.
- Implementar autenticación, autorización y auditoría.
- Ampliar la evaluación de respuestas del modelo y el manejo de errores.
- Añadir pruebas automatizadas de API, validaciones e idempotencia.
- Desplegar la solución en un entorno accesible para evaluación.

### 10. Uso de herramientas de inteligencia artificial

Se utilizó asistencia de inteligencia artificial durante el desarrollo para apoyar la implementación, revisar decisiones técnicas y elaborar documentación. La solución se ejecuta localmente y utiliza Ollama para la interpretación conversacional.
