"""
Persistencia de proyectos en SQLite (stdlib, sin dependencias).

Cada guardado crea una revisión nueva e inmutable (Rev. 1, 2, 3...), como las
revisiones de un plano. El guardado usa control de concurrencia optimista: el
cliente envía la revisión sobre la que trabajó y, si alguien guardó otra entre
medio, se rechaza con conflicto en vez de pisar cambios.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from models import Project

DB_PATH = Path(os.getenv("PMBOK_DB_PATH", Path(__file__).resolve().parent.parent / "data" / "pmbok_studio.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS proyectos (
    id          TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    rev_actual  INTEGER NOT NULL,
    creado      TEXT NOT NULL,
    actualizado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisiones (
    proyecto_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    rev         INTEGER NOT NULL,
    nota        TEXT NOT NULL DEFAULT '',
    errores     INTEGER NOT NULL DEFAULT 0,
    datos       TEXT NOT NULL,
    creado      TEXT NOT NULL,
    PRIMARY KEY (proyecto_id, rev)
);
"""


class NotFound(LookupError):
    pass


class Conflict(RuntimeError):
    def __init__(self, rev_actual: int):
        super().__init__(f"El proyecto ya está en la revisión {rev_actual}.")
        self.rev_actual = rev_actual


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db() -> None:
    with _conn() as con:
        con.executescript(SCHEMA)


def _dump(project: Project) -> str:
    return project.model_dump_json()


def listar() -> list[dict]:
    with _conn() as con:
        filas = con.execute(
            """SELECT p.id, p.nombre, p.rev_actual, p.creado, p.actualizado, r.errores
               FROM proyectos p JOIN revisiones r ON r.proyecto_id = p.id AND r.rev = p.rev_actual
               ORDER BY p.actualizado DESC"""
        ).fetchall()
    return [dict(f) for f in filas]


def crear(project: Project, nota: str = "", errores: int = 0) -> dict:
    pid, ahora = uuid.uuid4().hex[:12], _ahora()
    with _conn() as con:
        con.execute("INSERT INTO proyectos VALUES (?, ?, 1, ?, ?)", (pid, project.nombre, ahora, ahora))
        con.execute("INSERT INTO revisiones VALUES (?, 1, ?, ?, ?, ?)", (pid, nota or "Creación", errores, _dump(project), ahora))
    return {"id": pid, "rev": 1, "actualizado": ahora}


def guardar(pid: str, project: Project, rev_base: int, nota: str = "", errores: int = 0) -> dict:
    ahora = _ahora()
    with _conn() as con:
        fila = con.execute("SELECT rev_actual FROM proyectos WHERE id = ?", (pid,)).fetchone()
        if not fila:
            raise NotFound(pid)
        if fila["rev_actual"] != rev_base:
            raise Conflict(fila["rev_actual"])
        rev = rev_base + 1
        con.execute("INSERT INTO revisiones VALUES (?, ?, ?, ?, ?, ?)", (pid, rev, nota, errores, _dump(project), ahora))
        con.execute("UPDATE proyectos SET nombre = ?, rev_actual = ?, actualizado = ? WHERE id = ?",
                    (project.nombre, rev, ahora, pid))
    return {"id": pid, "rev": rev, "actualizado": ahora}


def obtener(pid: str, rev: Optional[int] = None) -> dict:
    with _conn() as con:
        p = con.execute("SELECT * FROM proyectos WHERE id = ?", (pid,)).fetchone()
        if not p:
            raise NotFound(pid)
        r = con.execute("SELECT * FROM revisiones WHERE proyecto_id = ? AND rev = ?",
                        (pid, rev or p["rev_actual"])).fetchone()
        if not r:
            raise NotFound(f"{pid} rev {rev}")
    return {"id": pid, "rev": r["rev"], "rev_actual": p["rev_actual"], "nota": r["nota"],
            "actualizado": r["creado"], "project": json.loads(r["datos"])}


def revisiones(pid: str) -> list[dict]:
    with _conn() as con:
        if not con.execute("SELECT 1 FROM proyectos WHERE id = ?", (pid,)).fetchone():
            raise NotFound(pid)
        filas = con.execute(
            "SELECT rev, nota, errores, creado FROM revisiones WHERE proyecto_id = ? ORDER BY rev DESC", (pid,)
        ).fetchall()
    return [dict(f) for f in filas]


def eliminar(pid: str) -> None:
    with _conn() as con:
        if con.execute("DELETE FROM proyectos WHERE id = ?", (pid,)).rowcount == 0:
            raise NotFound(pid)
