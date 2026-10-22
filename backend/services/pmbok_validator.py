"""
Cálculos EVM, puntaje de riesgos y reglas de auditoría PMBOK.

Política de severidad (build_presets.cjs → politica_auditoria):
- error:   bloquea marcar como validado / exportar versión aprobada.
- warning: recomienda revisión sin bloquear.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Optional

from models import (
    ESTRATEGIAS_PERMITIDAS,
    EstadoEntregable,
    EVMInput,
    EVMResult,
    ModoEVM,
    Project,
    RiskAssessment,
    Riesgo,
    Section,
    Severity,
    TipoIndicador,
    TipoRiesgo,
    EstrategiaRiesgo,
    ValidationIssue,
    ValidationReport,
)

TOLERANCIA = 1e-6
CONCENTRACION_R_MAX = 0.5  # fracción de entregables con el mismo R

GRAVEDAD_LABELS = {1: "Insignificante", 2: "Menor", 3: "Moderada", 4: "Importante", 5: "Catastrófica"}
PROBABILIDAD_LABELS = {1: "Muy improbable", 2: "No es probable", 3: "Posible", 4: "Probable", 5: "Muy probable"}


# --------------------------------------------------------------------------- #
# Riesgos
# --------------------------------------------------------------------------- #
def formato_gravedad(valor: int) -> str:
    return f"{valor} ({GRAVEDAD_LABELS[valor]})"


def formato_probabilidad(valor: int) -> str:
    return f"{valor} ({PROBABILIDAD_LABELS[valor]})"


def puntaje_riesgo(gravedad: int, probabilidad: int) -> int:
    return gravedad * probabilidad


def clasificar_impacto(puntaje: int) -> str:
    if puntaje <= 6:
        return "Bajo"
    if puntaje <= 12:
        return "Medio"
    return "Alto"


def formato_estrategia(riesgo: Riesgo) -> str:
    return f"{riesgo.tipo_estrategia.value}: {riesgo.estrategia}"


def evaluar_riesgo(riesgo: Riesgo) -> RiskAssessment:
    puntaje = puntaje_riesgo(riesgo.gravedad, riesgo.probabilidad)
    return RiskAssessment(
        codigo=riesgo.codigo,
        puntaje=puntaje,
        impacto=clasificar_impacto(puntaje),
        gravedad_label=formato_gravedad(riesgo.gravedad),
        probabilidad_label=formato_probabilidad(riesgo.probabilidad),
        estrategia_label=formato_estrategia(riesgo),
    )


# --------------------------------------------------------------------------- #
# EVM
# --------------------------------------------------------------------------- #
def _div(a: float, b: float) -> Optional[float]:
    return a / b if abs(b) > TOLERANCIA else None


def _estado(indice: Optional[float], bajo: str, ok: str, alto: str) -> str:
    if indice is None:
        return "Sin datos"
    if indice < 1 - TOLERANCIA:
        return bajo
    if indice > 1 + TOLERANCIA:
        return alto
    return ok


def esta_aprobado_al_corte(d, semana_corte: int) -> bool:
    return (
        d.estado == EstadoEntregable.APROBADO
        and d.aprobacion is not None
        and d.aprobacion.semana_aprobacion <= semana_corte
    )


def resolver_evm(p: Project) -> EVMInput:
    """
    Devuelve las métricas base efectivas. En modo línea base:
      BAC = Σ presupuesto
      PV  = Σ presupuesto de entregables con fin_semana_plan <= semana_corte
      EV  = Σ presupuesto de entregables aprobados hasta el corte (regla 0/100)
      AC  = Σ importe de registro_costos con semana <= semana_corte
    y % avance = EV / BAC, de modo que EV = (% avance / 100) * BAC se mantiene.
    """
    evm = p.evm
    if evm.modo == ModoEVM.MANUAL:
        return evm
    corte = evm.semana_corte
    bac = sum(d.presupuesto for d in p.dod)
    pv = sum(d.presupuesto for d in p.dod if d.fin_semana_plan is not None and d.fin_semana_plan <= corte)
    ev = sum(d.presupuesto for d in p.dod if esta_aprobado_al_corte(d, corte))
    ac = sum(c.importe for c in evm.registro_costos if c.semana <= corte)
    return evm.model_copy(update={
        "bac": bac,
        "pv": pv,
        "ac": ac,
        "porcentaje_avance": (ev / bac * 100) if bac > TOLERANCIA else 0.0,
    })


def serie_semanal(p: Project) -> list[dict]:
    """
    PV/EV/AC acumulados por semana (modo línea base). PV se proyecta hasta el fin
    del plan; EV y AC son reales y solo existen hasta la semana de corte (None después).
    """
    corte = p.evm.semana_corte
    ultima = max([1, corte]
                 + [d.fin_semana_plan for d in p.dod if d.fin_semana_plan is not None]
                 + [c.semana for c in p.evm.registro_costos])
    serie = []
    for w in range(ultima + 1):
        pv = sum(d.presupuesto for d in p.dod if d.fin_semana_plan is not None and d.fin_semana_plan <= w)
        real = w <= corte
        ev = sum(d.presupuesto for d in p.dod if esta_aprobado_al_corte(d, w)) if real else None
        ac = sum(c.importe for c in p.evm.registro_costos if c.semana <= w) if real else None
        serie.append({"semana": w, "pv": pv, "ev": ev, "ac": ac})
    return serie


def calcular_evm(evm: EVMInput) -> EVMResult:
    ev = (evm.porcentaje_avance / 100) * evm.bac
    spi = _div(ev, evm.pv)
    cpi = _div(ev, evm.ac)
    eac = _div(evm.bac, cpi) if cpi else None
    return EVMResult(
        modo=evm.modo,
        semana_corte=evm.semana_corte,
        bac=evm.bac,
        pv=evm.pv,
        ac=evm.ac,
        porcentaje_avance=evm.porcentaje_avance,
        ev=ev,
        sv=ev - evm.pv,
        cv=ev - evm.ac,
        spi=spi,
        cpi=cpi,
        eac=eac,
        etc=eac - evm.ac if eac is not None else None,
        vac=evm.bac - eac if eac is not None else None,
        tcpi=_div(evm.bac - ev, evm.bac - evm.ac),
        estado_cronograma=_estado(spi, "Atrasado", "En plazo", "Adelantado"),
        estado_costo=_estado(cpi, "Sobrecosto", "En presupuesto", "Bajo presupuesto"),
    )


# --------------------------------------------------------------------------- #
# Auditoría
# --------------------------------------------------------------------------- #
class _Issues(list):
    def add(self, severity: Severity, section: Section, code: str, message: str, ref: Optional[str] = None):
        self.append(ValidationIssue(severity=severity, section=section, code=code, message=message, ref=ref))

    def error(self, *args, **kw):
        self.add(Severity.ERROR, *args, **kw)

    def warning(self, *args, **kw):
        self.add(Severity.WARNING, *args, **kw)

    def info(self, *args, **kw):
        self.add(Severity.INFO, *args, **kw)


def _duplicados(valores: list[str]) -> list[str]:
    return sorted(v for v, n in Counter(valores).items() if n > 1)


def _validar_equipo(p: Project, out: _Issues) -> None:
    for rol in _duplicados(p.roles):
        out.error("equipo", "EQ-01", f"El rol '{rol}' está repetido; los roles son claves únicas.", rol)


def _validar_dod(p: Project, out: _Issues) -> None:
    roles = set(p.roles)
    for cod in _duplicados([d.codigo for d in p.dod]):
        out.error("dod", "DOD-01", f"Código de entregable duplicado: {cod}.", cod)
    if not p.dod:
        out.warning("dod", "DOD-02", "El proyecto no tiene entregables definidos.")
    for d in p.dod:
        if d.responsable not in roles:
            out.error("dod", "DOD-03", f"{d.codigo}: el responsable '{d.responsable}' no pertenece al equipo.", d.codigo)
        if not d.evidencia:
            out.warning("dod", "DOD-04", f"{d.codigo}: no describe la evidencia/comprobación esperada.", d.codigo)
        if d.fecha_entrega and p.fecha_fin and d.fecha_entrega > p.fecha_fin:
            out.warning("dod", "DOD-05", f"{d.codigo}: la fecha de entrega supera la fecha de fin del proyecto.", d.codigo)


def _rol_accountable(p: Project, codigo: str) -> Optional[str]:
    fila = p.raci.get(codigo, {})
    a = [rol for rol, v in fila.items() if v == "A"]
    return a[0] if len(a) == 1 else None


def _validar_aprobaciones(p: Project, out: _Issues) -> None:
    corte = p.evm.semana_corte
    linea_base = p.evm.modo == ModoEVM.LINEA_BASE
    for d in p.dod:
        if d.estado in (EstadoEntregable.EN_REVISION, EstadoEntregable.APROBADO) and not d.evidencia_registrada:
            out.error("dod", "APR-01", f"{d.codigo}: está '{d.estado.value}' sin evidencia registrada.", d.codigo)
        if d.estado == EstadoEntregable.APROBADO:
            if d.aprobacion is None:
                out.error("dod", "APR-02", f"{d.codigo}: está Aprobado pero no tiene registro de aprobación.", d.codigo)
                continue
            rol_a = _rol_accountable(p, d.codigo)
            if rol_a and d.aprobacion.rol_aprobador != rol_a:
                out.error(
                    "dod", "APR-03",
                    f"{d.codigo}: lo aprobó '{d.aprobacion.rol_aprobador}', pero el aprobador según la RACI es '{rol_a}'.",
                    d.codigo,
                )
            if linea_base and d.aprobacion.semana_aprobacion > corte:
                out.error(
                    "dod", "APR-04",
                    f"{d.codigo}: semana de aprobación {d.aprobacion.semana_aprobacion} posterior al corte (semana {corte}).",
                    d.codigo,
                )
        elif d.aprobacion is not None:
            out.warning("dod", "APR-05", f"{d.codigo}: tiene aprobación registrada pero su estado es '{d.estado.value}'.", d.codigo)
        if d.estado == EstadoEntregable.RECHAZADO and not d.comentario_revision:
            out.warning("dod", "APR-06", f"{d.codigo}: rechazado sin indicar el motivo.", d.codigo)


def _validar_raci(p: Project, out: _Issues) -> None:
    roles = set(p.roles)
    dod_por_codigo = {d.codigo: d for d in p.dod}

    for cod in p.raci:
        if cod not in dod_por_codigo:
            out.error("raci", "RACI-01", f"La actividad RACI '{cod}' no corresponde a ningún entregable del DoD.", cod)
    for cod in dod_por_codigo:
        if cod not in p.raci:
            out.error("raci", "RACI-02", f"El entregable {cod} no tiene asignaciones RACI.", cod)

    conteo_r: Counter[str] = Counter()
    con_asignacion: set[str] = set()

    for cod, fila in p.raci.items():
        for rol in fila:
            if rol not in roles:
                out.error("raci", "RACI-03", f"{cod}: el rol '{rol}' no pertenece al equipo.", cod)

        asignados = {rol: v for rol, v in fila.items() if v and rol in roles}
        con_asignacion.update(asignados)
        a = [rol for rol, v in asignados.items() if v == "A"]
        r = [rol for rol, v in asignados.items() if v == "R"]

        if len(a) != 1:
            out.error("raci", "RACI-04", f"{cod}: debe tener exactamente un 'A' (tiene {len(a)}).", cod)
        if not r:
            out.error("raci", "RACI-05", f"{cod}: debe tener al menos un 'R'.", cod)
        elif len(r) > 1:
            out.warning(
                "raci", "RACI-06",
                f"{cod}: tiene {len(r)} 'R' ({', '.join(r)}); la política del producto recomienda un único R.", cod,
            )
        conteo_r.update(r)

        d = dod_por_codigo.get(cod)
        if d and d.responsable in roles and fila.get(d.responsable) != "R":
            out.error(
                "raci", "RACI-07",
                f"{cod}: el responsable del DoD ('{d.responsable}') debe figurar como 'R' en la RACI.", cod,
            )

    total = len(p.raci)
    if total:
        for rol, n in conteo_r.items():
            if n / total > CONCENTRACION_R_MAX + TOLERANCIA:
                out.warning(
                    "raci", "RACI-08",
                    f"'{rol}' es R en {n} de {total} entregables (>50%); revisar carga y disponibilidad.", rol,
                )
    for rol in p.roles:
        if rol not in con_asignacion:
            out.warning("raci", "RACI-09", f"'{rol}' no tiene ninguna asignación en la RACI.", rol)


def _validar_riesgos(p: Project, out: _Issues) -> list[RiskAssessment]:
    roles = set(p.roles)
    codigos_dod = {d.codigo for d in p.dod}
    for cod in _duplicados([r.codigo for r in p.riesgos]):
        out.error("riesgos", "RSK-01", f"Código de riesgo duplicado: {cod}.", cod)

    evaluaciones = []
    for r in p.riesgos:
        ev = evaluar_riesgo(r)
        evaluaciones.append(ev)
        if r.propietario not in roles:
            out.error("riesgos", "RSK-02", f"{r.codigo}: el propietario '{r.propietario}' no pertenece al equipo.", r.codigo)
        if r.tipo_estrategia not in ESTRATEGIAS_PERMITIDAS[r.tipo]:
            permitidas = ", ".join(e.value for e in ESTRATEGIAS_PERMITIDAS[r.tipo])
            out.error(
                "riesgos", "RSK-03",
                f"{r.codigo}: '{r.tipo_estrategia.value}' no es válida para {r.tipo.value} (permitidas: {permitidas}).",
                r.codigo,
            )
        for cod in r.entregables_afectados:
            if cod not in codigos_dod:
                out.error("riesgos", "RSK-04", f"{r.codigo}: el entregable afectado '{cod}' no existe en el DoD.", r.codigo)
        if (
            r.tipo == TipoRiesgo.AMENAZA
            and ev.impacto == "Alto"
            and r.tipo_estrategia == EstrategiaRiesgo.ACEPTAR
            and not r.justificacion_aceptacion
        ):
            out.warning(
                "riesgos", "RSK-05",
                f"{r.codigo}: amenaza de impacto Alto (puntaje {ev.puntaje}) aceptada sin justificación.", r.codigo,
            )
    return evaluaciones


# --------------------------------------------------------------------------- #
# KPIs: meta numérica y semáforo
# --------------------------------------------------------------------------- #
def _parse_num(s: str) -> Optional[float]:
    s = s.strip()
    if "," in s:  # formato es-CL: 1.234,5
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def meta_numerica(p: Project, k, semana: int) -> Optional[tuple[str, float]]:
    """('>=' | '<=', valor) para comparar una medición, o None si la meta no es numérica."""
    m = k.meta
    if isinstance(m, str):
        g = re.search(r"(>=|<=|≥|≤)\s*(-?[\d.,]+)", m)
        if not g:
            return None
        v = _parse_num(g.group(2))
        return (">=" if g.group(1) in (">=", "≥") else "<=", v) if v is not None else None
    if m.tipo == "Minimo" and m.valor is not None:
        return ">=", m.valor
    if m.tipo == "Maximo" and m.valor is not None:
        return "<=", m.valor
    if m.tipo == "Minimo_referenciado" and m.referencia:
        total = len(p.dod)
        if m.referencia.strip().upper() == "PV":
            return ">=", sum(d.presupuesto for d in p.dod if d.fin_semana_plan is not None and d.fin_semana_plan <= semana)
        if "entregables_planificados_acumulados" in m.referencia and total:
            plan = sum(1 for d in p.dod if d.fin_semana_plan is not None and d.fin_semana_plan <= semana)
            return ">=", 100 * plan / total
    return None


def evaluar_kpi(p: Project, k) -> dict:
    if not k.mediciones:
        return {"codigo": k.codigo, "estado": "sin_datos", "valor": None, "semana": None, "meta": None}
    ult = max(k.mediciones, key=lambda x: x.semana)
    meta = meta_numerica(p, k, ult.semana)
    base = {"codigo": k.codigo, "valor": ult.valor, "semana": ult.semana, "meta": meta[1] if meta else None}
    if meta is None:
        return {**base, "estado": "sin_meta"}
    op, objetivo = meta
    if (ult.valor >= objetivo - TOLERANCIA) if op == ">=" else (ult.valor <= objetivo + TOLERANCIA):
        estado = "cumple"
    elif (ult.valor >= 0.9 * objetivo) if op == ">=" else (ult.valor <= 1.1 * objetivo):
        estado = "en_riesgo"
    else:
        estado = "no_cumple"
    return {**base, "estado": estado}


def _validar_cronograma(p: Project, out: _Issues) -> None:
    corte = p.evm.semana_corte
    for d in p.dod:
        if d.inicio_semana_plan is not None and d.fin_semana_plan is not None and d.inicio_semana_plan > d.fin_semana_plan:
            out.error("dod", "CRO-01", f"{d.codigo}: la semana de inicio ({d.inicio_semana_plan}) es posterior a la de fin ({d.fin_semana_plan}).", d.codigo)
        if (
            p.evm.modo == ModoEVM.LINEA_BASE
            and d.fin_semana_plan is not None
            and d.fin_semana_plan <= corte
            and not esta_aprobado_al_corte(d, corte)
        ):
            out.warning("dod", "CRO-02", f"{d.codigo}: debía terminar en la semana {d.fin_semana_plan} y no está aprobado al corte.", d.codigo)


def _validar_kpis(p: Project, out: _Issues) -> None:
    roles = set(p.roles)
    for cod in _duplicados([k.codigo for k in p.kpis]):
        out.error("kpis", "KPI-01", f"Código de KPI duplicado: {cod}.", cod)
    for k in p.kpis:
        if k.responsable not in roles:
            out.error("kpis", "KPI-02", f"{k.codigo}: el responsable '{k.responsable}' no pertenece al equipo.", k.codigo)
    if p.kpis and not any(k.tipo_indicador == TipoIndicador.ADELANTADO for k in p.kpis):
        out.warning(
            "kpis", "KPI-03",
            "Todos los KPIs son rezagados; considerar al menos un indicador adelantado.",
        )
    for k in p.kpis:
        ev = evaluar_kpi(p, k)
        if ev["estado"] == "no_cumple":
            out.warning("kpis", "KPI-04", f"{k.codigo} ({k.nombre}): la última medición ({_num_txt(ev['valor'])}) no cumple la meta ({_num_txt(ev['meta'])}).", k.codigo)
        if p.evm.modo == ModoEVM.LINEA_BASE and any(m.semana > p.evm.semana_corte for m in k.mediciones):
            out.warning("kpis", "KPI-05", f"{k.codigo}: tiene mediciones posteriores a la semana de corte.", k.codigo)


def _num_txt(v: Optional[float]) -> str:
    return "—" if v is None else f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".").rstrip("0").rstrip(",")


def _validar_evm(p: Project, r, out: _Issues) -> None:
    if p.evm.modo == ModoEVM.LINEA_BASE:
        codigos = {d.codigo for d in p.dod}
        if r.bac <= TOLERANCIA:
            out.error("evm", "EVM-01", "BAC = 0: asigna presupuesto a los entregables de la línea base.")
        for d in p.dod:
            if d.presupuesto <= TOLERANCIA:
                out.warning("evm", "EVM-07", f"{d.codigo}: sin presupuesto en la línea base.", d.codigo)
            if d.fin_semana_plan is None:
                out.warning("evm", "EVM-08", f"{d.codigo}: sin semana de fin planificada; no suma al PV.", d.codigo)
        for c in p.evm.registro_costos:
            if c.entregable_codigo not in codigos:
                out.error("evm", "EVM-09", f"Costo {c.id}: el entregable '{c.entregable_codigo}' no existe.", c.id)
            elif c.semana > p.evm.semana_corte:
                out.info("evm", "EVM-10", f"Costo {c.id}: semana {c.semana} posterior al corte; no se incluye en AC.", c.id)
    else:
        if r.bac <= TOLERANCIA:
            out.error("evm", "EVM-01", "BAC debe ser mayor que 0.")
        if r.pv > r.bac + TOLERANCIA:
            out.error("evm", "EVM-02", "PV no puede superar el BAC.")
    if r.spi is None:
        out.info("evm", "EVM-03", "SPI no calculable: PV = 0 (sin trabajo planificado al corte).")
    elif r.spi < 1 - TOLERANCIA:
        out.warning("evm", "EVM-04", f"SPI = {r.spi:.2f} < 1: el proyecto va atrasado.")
    if r.cpi is None:
        out.info("evm", "EVM-05", "CPI no calculable: AC = 0 (sin costos registrados).")
    elif r.cpi < 1 - TOLERANCIA:
        out.warning("evm", "EVM-06", f"CPI = {r.cpi:.2f} < 1: el proyecto tiene sobrecosto.")


def validate_project(project: Project) -> ValidationReport:
    issues = _Issues()
    _validar_equipo(project, issues)
    _validar_dod(project, issues)
    _validar_raci(project, issues)
    _validar_aprobaciones(project, issues)
    _validar_cronograma(project, issues)
    riesgos = _validar_riesgos(project, issues)
    _validar_kpis(project, issues)
    evm = calcular_evm(resolver_evm(project))
    _validar_evm(project, evm, issues)

    errores = sum(1 for i in issues if i.severity == Severity.ERROR)
    advertencias = sum(1 for i in issues if i.severity == Severity.WARNING)
    return ValidationReport(
        valid=errores == 0,
        errores=errores,
        advertencias=advertencias,
        issues=list(issues),
        evm=evm,
        riesgos=riesgos,
    )
