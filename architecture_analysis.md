# Análisis de Arquitectura – Evolution Manager v2

## 1. Stack Tecnológico Real
- **Frontend:** React 18.3.1 (Vite + TypeScript).
- **Estilos:** TailwindCSS + Radix UI (componentes de shadcn/ui en `src/components/ui`).
- **Estado y API:** TanStack React Query (v5) con Axios para llamadas HTTP directas a Evolution API.
- **Base de Datos / Persistencia:** No existe en el frontend. Toda la persistencia es local a nivel de navegador (`localStorage` para tokens y URL de API) o en el servidor PostgreSQL remoto de la propia Evolution API.
- **Rutas:** React Router DOM (v6).
- **Despliegue:** 
  - **Desarrollo:** Contenedor Docker (`evolution_manager_dev`) ejecutando `npm run dev` en puerto `3000` (mapeado a `3001` en host).
  - **Producción:** Dockerfile basado en Nginx que sirve los archivos estáticos generados por `npm run build`.

---

## 2. Puntos Clave de la Integración
- **Llamadas a Evolution API:** Centralizadas en `src/lib/queries/chat/sendMessage.ts`. Los endpoints principales de envío de texto y multimedia son:
  - `POST /message/sendText/:instanceName`
  - `POST /message/sendMedia/:instanceName`
- **Listado de Mensajes:** En `src/pages/instance/Chat/messages.tsx` usando el nuevo hook unificado `useAggregatedMessages`.
- **Listado de Chats/Conversaciones:** En `src/pages/instance/Chat/index.tsx` usando `useFindChats`.
- **Composer / Input de Mensajes:** Integrado directamente en `src/pages/instance/Chat/messages.tsx` (el textarea y los botones de envío están al final del componente).

---

## 3. Estrategia para Mensajes Programados (Scheduled Messages)

Dado que la aplicación es 100% frontend y la programación debe persistir si el navegador se cierra, **necesitamos un backend persistente con un worker/scheduler**. 

### Propuesta Técnica Coherente y Ligera:
Para evitar sobreingeniería y mantener la simplicidad, crearemos un pequeño **Express Server integrado en la misma estructura** del proyecto (en una carpeta `src/server/` o `server/`):
1. **Base de Datos:** Usaremos **SQLite** (a través de `better-sqlite3` o `sqlite3` de Node) para persistir los mensajes programados. No requiere configuración externa de infraestructura, soporta transacciones atómicas (bloqueos seguros ante duplicados) y sobrevive a reinicios.
2. **Servidor Express:** Expondrá los endpoints REST para crear, listar, editar y cancelar mensajes programados.
3. **Worker/Scheduler:** Un simple loop `setInterval` (o `node-cron`) en el proceso del backend que se ejecuta cada 30 segundos. Consultará la base de datos SQLite de forma atómica:
   ```sql
   UPDATE scheduled_messages
   SET status = 'processing', updatedAt = datetime('now')
   WHERE id = ? AND status = 'pending'
   ```
   Si el UPDATE afecta exactamente a 1 fila, procederá a realizar la llamada a Evolution API (reutilizando el token y la URL configurados) y marcará el estado como `sent` o `failed`.
4. **Despliegue Integrado:** Actualizaremos la configuración de Docker / Nginx para servir el frontend y proxyar las peticiones `/api/scheduled-messages` al servidor Express.

---

## 4. Estructura de la Base de Datos (SQLite Table)
```sql
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  instanceName TEXT NOT NULL,
  instanceToken TEXT NOT NULL,
  remoteJid TEXT NOT NULL,
  canonicalRemoteJid TEXT,
  messageText TEXT NOT NULL,
  scheduledAtUtc TEXT NOT NULL, -- Timestamp ISO en UTC
  timezone TEXT DEFAULT 'Europe/Madrid',
  status TEXT DEFAULT 'pending', -- pending | processing | sent | failed | cancelled
  attempts INTEGER DEFAULT 0,
  maxAttempts INTEGER DEFAULT 3,
  lastError TEXT,
  sentAtUtc TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  evolutionMessageId TEXT
);
```

---

## 5. Endpoints de la API Backend (`/api/scheduled-messages`)
- `POST /api/scheduled-messages` – Crear programación (acepta `scheduledAtLocal` en hora Europe/Madrid o `delayMinutes`).
- `GET /api/scheduled-messages?remoteJid=...` – Listar programados para un contacto específico.
- `PATCH /api/scheduled-messages/:id` – Editar texto o fecha/hora de mensajes `pending`.
- `POST /api/scheduled-messages/:id/cancel` – Cancelar un mensaje `pending`.
- `POST /api/scheduled-messages/:id/send-now` – Forzar el envío inmediato.

---

## 6. Cambios en la Interfaz (Frontend UI)
- **Botón "Programar":** Se agregará junto al botón enviar en `messages.tsx` (un icono de reloj 🕒 o botón discreto).
- **Modal de Programación:** Permitirá ingresar el mensaje, seleccionar modo (retraso en minutos o fecha/hora exacta) y mostrará un resumen del envío.
- **Panel de Mensajes Programados:** Mostrará la lista de programaciones pendientes debajo del composer o en una sección del chat con opciones de editar y cancelar.
