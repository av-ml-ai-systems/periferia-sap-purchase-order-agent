# Agente Conversacional de Órdenes de Compra SAP

**Reto 3 — Periferia IT Group**

Agente conversacional para revisar solicitudes de órdenes de compra a partir de paquetes de prueba, validar reglas de negocio y simular la creación de órdenes de compra en SAP. La solución incluye una interfaz web, una API REST, interpretación de lenguaje natural mediante Ollama y trazabilidad local.

> **Alcance:** la integración con SAP es simulada. No se realizan operaciones en un sistema SAP real.

## Arquitectura

- **Interfaz web:** HTML, CSS y JavaScript en `public/`.
- **API REST:** Node.js, Express, TypeScript y Zod.
- **LLM local:** Ollama con `llama3.2:1b`.
- **Herramientas de negocio:** lectura de paquetes de prueba, validación de reglas y creación de órdenes de compra.
- **Adaptador SAP:** contrato `SapAdapter` e implementación `MockSapAdapter` para simular las consultas de proveedores y la creación de órdenes.
- **Idempotencia:** consulta de órdenes existentes por referencia de solicitud para evitar duplicar órdenes al procesar una misma solicitud.
- **Datos de prueba:** archivos JSON y TXT en `fixtures/reto-03/`.
- **Salidas:** evidencias, trazabilidad y registro de órdenes simuladas en `out/`.

## Requisitos

- Node.js y npm.
- Ollama instalado.
- Modelo `llama3.2:1b` descargado localmente.

## Instalación y ejecución

Desde la raíz del proyecto, instala las dependencias y descarga el modelo:

```powershell
npm install
ollama pull llama3.2:1b
```

Si Ollama no se está ejecutando como servicio, inicia el servidor en una terminal:

```powershell
ollama serve
```

En otra terminal, inicia la aplicación:

```powershell
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en el navegador.

## Pruebas rápidas

### 1. Verificar los tipos de TypeScript

```powershell
npx tsc --noEmit
```

### 2. Ejecutar los seis casos de demostración

```powershell
npm run demo
```

### 3. Comprobar el estado de la API

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health"
```

### 4. Enviar una solicitud conversacional

```powershell
$body = @{
    sessionId = "demo-manual"
    message = "Revisa el primer caso"
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "http://localhost:3000/api/chat" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body
```

## API

### `GET /api/health`

Devuelve información sobre el estado básico de la API, el proveedor y el modelo configurado.

### `POST /api/chat`

Recibe un mensaje conversacional y el identificador de sesión.

Ejemplo de cuerpo JSON:

```json
{
  "sessionId": "demo-manual",
  "message": "Revisa el primer caso"
}
```

La respuesta contiene el resultado conversacional, las herramientas ejecutadas y, cuando corresponde, información sobre una confirmación pendiente.

### `GET /api/sessions/:id`

Consulta el historial en memoria de una sesión existente.

## Casos de prueba

- **`sol-001`:** solicitud válida; creación simulada de una orden y comportamiento idempotente.
- **`sol-002`:** proveedor inexistente.
- **`sol-003`:** problemas de autorización y límite monetario.
- **`sol-004`:** diferencia entre solicitud y cotización que requiere confirmación.
- **`sol-005`:** detección de fecha retroactiva que requiere confirmación.
- **`sol-006`:** datos derivados de los maestros que requieren confirmación cuando corresponde.

## Seguridad y limitaciones

- No existe conexión con un sistema SAP real.
- Las órdenes son simuladas mediante `MockSapAdapter`; no se crean órdenes en SAP.
- Los registros de órdenes y la trazabilidad se almacenan localmente en `out/`.
- Las sesiones se guardan en memoria y se pierden al reiniciar el servidor.
- El modelo interpreta la intención del usuario; las validaciones de negocio se ejecutan mediante código determinista.
- La solución está diseñada para una demostración local, no para un entorno de producción.
- No se incluye un despliegue público en esta entrega.
