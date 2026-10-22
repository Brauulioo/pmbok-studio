"""
API de PMBOK Studio.

Desde backend/:            uvicorn main:app --reload
Desde la raíz del repo:    uvicorn backend.main:app --reload
"""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from models import Project, ValidationReport
from services.excel_exporter import (
    TemplateError, export_project_zip, missing_templates, origen_plantillas, slugify,
)
from services.pdf_report import build_pdf
from services.pmbok_validator import validate_project
from services.preset_loader import PresetsNotFound, load_presets
from services import project_store as store
from pydantic import BaseModel


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.init_db()
    yield


app = FastAPI(title="PMBOK Studio API", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("PMBOK_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Validation-Errors", "X-Validation-Warnings"],
)


@app.get("/api/health")
def health():
    faltantes = missing_templates()
    return {"status": "ok" if not faltantes else "degraded", "plantillas": origen_plantillas(),
            "plantillas_faltantes": faltantes}


@app.get("/api/presets", response_model=list[Project])
def presets():
    try:
        return load_presets()
    except PresetsNotFound as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/api/validate", response_model=ValidationReport)
def validate(project: Project):
    return validate_project(project)


@app.post("/api/export-zip")
def export_zip(
    project: Project,
    forzar: bool = Query(False, description="Exportar aunque existan errores de validación (borrador)"),
):
    report = validate_project(project)
    if not report.valid and not forzar:
        return JSONResponse(status_code=422, content={
            "detail": "El proyecto tiene errores de validación. Corrígelos o usa ?forzar=true para exportar un borrador.",
            "report": report.model_dump(mode="json"),
        })

    try:
        zip_buffer = export_project_zip(project, report)
    except TemplateError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    filename = f"{slugify(project.nombre)}_matrices_PMBOK.zip"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}",
            "X-Validation-Errors": str(report.errores),
            "X-Validation-Warnings": str(report.advertencias),
        },
    )


@app.post("/api/report-pdf")
def report_pdf(project: Project):
    """Informe ejecutivo de una página. Se emite aunque haya errores: los muestra en la hoja de observaciones."""
    report = validate_project(project)
    filename = f"{slugify(project.nombre)}_informe_ejecutivo.pdf"
    return Response(
        content=build_pdf(project, report),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}",
            "X-Validation-Errors": str(report.errores),
            "X-Validation-Warnings": str(report.advertencias),
        },
    )


# --------------------------------------------------------------------------- #
# Proyectos guardados (SQLite) con revisiones
# --------------------------------------------------------------------------- #
class GuardarProyecto(BaseModel):
    project: Project
    nota: str = ""
    rev_base: int | None = None  # requerido al actualizar: revisión sobre la que se trabajó


@app.get("/api/projects")
def listar_proyectos():
    return store.listar()


@app.post("/api/projects", status_code=201)
def crear_proyecto(body: GuardarProyecto):
    report = validate_project(body.project)
    return store.crear(body.project, body.nota, report.errores)


@app.get("/api/projects/{pid}")
def obtener_proyecto(pid: str, rev: int | None = None):
    try:
        return store.obtener(pid, rev)
    except store.NotFound:
        raise HTTPException(status_code=404, detail="Proyecto o revisión no encontrado.")


@app.put("/api/projects/{pid}")
def guardar_proyecto(pid: str, body: GuardarProyecto):
    if body.rev_base is None:
        raise HTTPException(status_code=422, detail="Falta rev_base: la revisión sobre la que trabajaste.")
    report = validate_project(body.project)
    try:
        return store.guardar(pid, body.project, body.rev_base, body.nota, report.errores)
    except store.NotFound:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado.")
    except store.Conflict as exc:
        raise HTTPException(status_code=409, detail={
            "message": f"Otra sesión guardó la revisión {exc.rev_actual} mientras editabas la {body.rev_base}.",
            "rev_actual": exc.rev_actual,
        })


@app.get("/api/projects/{pid}/revisions")
def revisiones_proyecto(pid: str):
    try:
        return store.revisiones(pid)
    except store.NotFound:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado.")


@app.delete("/api/projects/{pid}", status_code=204)
def eliminar_proyecto(pid: str):
    try:
        store.eliminar(pid)
    except store.NotFound:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado.")
