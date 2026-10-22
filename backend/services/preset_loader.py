"""
Carga los presets generados por data/build_presets.cjs (data/presets.json) y los
convierte al modelo `Project`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from models import EVMInput, ModoEVM, Project, TeamMember

BACKEND_DIR = Path(__file__).resolve().parent.parent
PRESETS_PATH = Path(os.getenv("PMBOK_PRESETS_PATH", BACKEND_DIR / "data" / "presets.json"))


class PresetsNotFound(RuntimeError):
    pass


def _evm_desde_preset(evm: dict) -> EVMInput:
    """El preset trae línea base por paquetes: el EVM se calcula (modo linea_base)."""
    corte = evm["corte"]
    return EVMInput(
        modo=ModoEVM.LINEA_BASE,
        semana_corte=int(corte.get("semana_corte") or 0),
        registro_costos=[
            {k: c[k] for k in ("id", "entregable_codigo", "semana", "importe", "descripcion") if k in c}
            for c in evm.get("registro_costos", [])
        ],
        unidad=evm.get("unidad", "UM"),
    )


def _dod_con_linea_base(p: dict) -> list[dict]:
    """Pasa los paquetes de la línea base a cada entregable. El inicio planificado se
    infiere como el fin del entregable anterior (los presets son secuenciales)."""
    paquetes = {pk["entregable_codigo"]: pk for pk in p["evm"]["linea_base"].get("paquetes", [])}
    out, fin_anterior = [], 0
    for d in p["dod_items"]:
        pk = paquetes.get(d["codigo"], {})
        fin = pk.get("fin_semana_plan")
        out.append({
            **d,
            "presupuesto": pk.get("presupuesto", 0),
            "inicio_semana_plan": fin_anterior if fin is not None else None,
            "fin_semana_plan": fin,
        })
        if fin is not None:
            fin_anterior = fin
    return out


def preset_a_proyecto(p: dict) -> Project:
    return Project(
        id=p["id"],
        nombre=p["nombre"],
        descripcion=p.get("descripcion", ""),
        equipo=[TeamMember(rol=r) for r in p["roles"]],
        dod=_dod_con_linea_base(p),
        raci=p["raci_assignments"],
        riesgos=p["risks"],
        kpis=p["kpis"],
        evm=_evm_desde_preset(p["evm"]),
    )


def load_presets() -> list[Project]:
    if not PRESETS_PATH.is_file():
        raise PresetsNotFound(
            f"No existe {PRESETS_PATH}. Genéralo con: node backend/data/build_presets.cjs"
        )
    data = json.loads(PRESETS_PATH.read_text(encoding="utf-8"))
    return [preset_a_proyecto(p) for p in data.get("presets", [])]
