# PMBOK Studio

Aplicación para armar, validar y hacer seguimiento de proyectos con prácticas PMBOK, y emitir el kit oficial: las 4 matrices en Excel (DoD, RACI, Riesgos y KPIs) más un informe ejecutivo en PDF, empaquetados en un `.zip`.

## Funcionalidades

- **Equipo y presets**: hasta 10 roles (columnas C–L de la plantilla RACI) y 3 presets universitarios (App Web/SaaS, Sistema IoT, Proyecto IA/Datos).
- **DoD + RACI sincronizados**: cada entregable del DoD es una fila de la RACI; validación en vivo (exactamente un `A`, al menos un `R`, el responsable del DoD es el `R`).
- **Flujo de aprobación**: Pendiente → En revisión → Aprobado/Rechazado, con evidencia registrada y aprobación solo por el rol `A`.
- **Cronograma (Gantt)** de entregables con estado, semana de aprobación y atrasos al corte.
- **Riesgos** con mapa de calor 5×5 y estrategias según amenaza u oportunidad.
- **Valor ganado (EVM)** calculado desde la línea base: PV por entregables planificados, EV por entregables aprobados (regla 0/100) y AC desde el registro de costos; SPI, CPI, EAC, ETC, VAC y **curva S**. También admite un modo manual.
- **KPIs** con historial de mediciones, semáforo contra la meta y cálculo automático de EV, SPI, CPI, % aprobado y cumplimiento del cronograma.
- **Proyectos guardados** en SQLite con revisiones inmutables y control de conflictos entre sesiones.
- **Exportación**: matrices Excel generadas sobre las plantillas originales + informe ejecutivo PDF de una página.

## Estructura

```
backend/
  main.py                  API FastAPI
  models.py                Modelos Pydantic v2
  services/
    pmbok_validator.py     Reglas PMBOK, EVM, curva S y semáforo de KPIs
    excel_exporter.py      Llenado de plantillas con openpyxl y .zip
    pdf_report.py          Informe ejecutivo (reportlab)
    project_store.py       Persistencia SQLite con revisiones
    preset_loader.py       Carga de presets
  scripts/
    crear_plantillas.py    Genera las plantillas Excel propias
  templates_base/          Plantillas Excel propias (incluidas en el repo)
  templates/               Plantillas originales opcionales (solo en local, ver LEEME.md)
  data/
    build_presets.cjs      Genera presets.json
    validate_presets.cjs   Valida presets.json
    presets.json           Presets (también los usa el frontend al compilar)
frontend/                  React + Vite + Tailwind CSS + lucide-react
```

## Requisitos

- Python 3.11 o superior
- Node.js 18 o superior

## Puesta en marcha

### Backend

Desde la raíz del repositorio:

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r backend/requirements.txt
uvicorn backend.main:app --port 8000
```

La API queda en http://localhost:8000 (documentación interactiva en http://localhost:8000/docs). La base de datos `backend/data/pmbok_studio.db` se crea sola al iniciar.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Abre http://localhost:5173. Para apuntar a otro backend, copia `frontend/.env.example` a `frontend/.env` y ajusta `VITE_API_URL`.

### Regenerar los presets (opcional)

```bash
node backend/data/build_presets.cjs
node backend/data/validate_presets.cjs
```

### Plantillas Excel

El kit se genera sobre plantillas: se cargan con openpyxl, se completan en coordenadas fijas y se conservan sus estilos y hojas de instrucciones.

- `backend/templates_base/` trae plantillas propias listas para usar. Si se modifica su diseño, se regeneran con `python backend/scripts/crear_plantillas.py`.
- Si tienes las plantillas originales de tu curso u organización, cópialas en `backend/templates/` con los nombres indicados en [LEEME.md](backend/templates/LEEME.md); tienen prioridad sobre las propias.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado y plantillas faltantes |
| GET | `/api/presets` | Presets como proyectos |
| POST | `/api/validate` | Reporte de validación + EVM + riesgos |
| POST | `/api/export-zip` | Kit `.zip` (422 si hay errores; `?forzar=true` emite borrador) |
| POST | `/api/report-pdf` | Solo el informe ejecutivo PDF |
| GET/POST | `/api/projects` | Listar / crear proyectos guardados |
| GET/PUT/DELETE | `/api/projects/{id}` | Abrir (`?rev=n`), guardar revisión (`rev_base`), eliminar |
| GET | `/api/projects/{id}/revisions` | Historial de revisiones |

## Notas

- Las reglas de validación se ejecutan igual en el frontend (respuesta inmediata) y en el backend (fuente de verdad al exportar).
- `npm run build:artifact` genera `frontend/artifact.html`, una versión de un solo archivo para vista previa sin backend.
