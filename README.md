
# Agente Conversacional de Órdenes de Compra SAP

Reto 3 — Periferia IT Group

Agente conversacional para revisar solicitudes de órdenes de compra a partir de paquetes de prueba, validar reglas de negocio y simular la creación de órdenes SAP. La solución incluye una interfaz web, una API REST, interpretación de lenguaje natural mediante Ollama y trazabilidad local.

> **Alcance:** la integración SAP es simulada. No se realizan operaciones en un sistema SAP real.

## Arquitectura

- **Interfaz:** HTML, CSS y JavaScript en `public/`.
- **API:** Node.js, Express, TypeScript y Zod.
- **LLM local:** Ollama con `llama3.2:1b`.
- **Herramientas de negocio:** lectura de paquetes, validación y creación simulada de órdenes.
- **Datos de prueba:** archivos JSON y TXT en `fixtures/reto-03/`.
- **Salidas:** evidencias, trazabilidad y registro de órdenes simuladas en `out/`.

## Requisitos

- Node.js y npm.
- Ollama instalado.
- Modelo `llama3.2:1b` disponible localmente.

## Instalación y ejecución

```powershell
npm install
ollama pull llama3.2:1b
```

En una terminal, inicia Ollama si no está activo:

```powershell
ollama serve
```

Si Ollama ya está ejecutándose como servicio, no necesitas iniciar otra instancia.

En otra terminal, inicia la aplicación:

```powershell
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Pruebas rápidas

Comprobar tipos de TypeScript:

```powershell
npx tsc --noEmit
```

Ejecutar la demostración de los seis casos:

```powershell
npm run demo
```

Comprobar la API:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Enviar una solicitud conversacional:

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

Devuelve el estado básico de la API, proveedor y modelo configurado.

### `POST /api/chat`

Cuerpo:

```json
{
  "sessionId": "demo-manual",
  "message": "Revisa el primer caso"
}
```

Devuelve la respuesta conversacional, las herramientas ejecutadas y si existe una confirmación pendiente.

### `GET /api/sessions/:id`

Consulta el historial en memoria de una sesión existente.

## Casos de prueba

- `sol-001`: solicitud válida.
- `sol-002`: proveedor inexistente.
- `sol-003`: problemas de autorización y límite monetario.
- `sol-004`: diferencia entre solicitud y cotización que requiere confirmación.
- `sol-005`: detección de fecha retroactiva que requiere confirmación.
- `sol-006`: datos derivados de los maestros que requieren confirmación cuando corresponde.

## Seguridad y limitaciones

- No se conecta a SAP real.
- Las órdenes son simuladas y los registros se almacenan localmente.
- Las sesiones se guardan en memoria y se pierden al reiniciar el servidor.
- El modelo interpreta la intención, pero las validaciones de negocio se ejecutan mediante código determinista.
- La aplicación está diseñada para demostración local, no para producción.
