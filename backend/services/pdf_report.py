"""
Informe ejecutivo de una página (A4) con el estilo "plano técnico" de PMBOK Studio:
estado general, indicadores EVM, curva S, entregables, riesgos altos y observaciones.
Se incluye en el .zip del kit junto a las 4 matrices Excel.
"""

from __future__ import annotations

import io
from datetime import date
from typing import Optional

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from models import EstadoEntregable, ModoEVM, Project, Severity, ValidationReport
from services.pmbok_validator import clasificar_impacto, puntaje_riesgo, serie_semanal

# Paleta (misma que el frontend en modo claro)
INK = HexColor("#1B3A5C")
MUTED = HexColor("#4E6580")
LINE = HexColor("#C5D0DC")
GRID = HexColor("#E7ECE8")
PAPER = HexColor("#F6F8F4")
WHITE = HexColor("#FFFFFF")
REDLINE = HexColor("#C2412D")
OK = HexColor("#2F7D4F")
WARN = HexColor("#8F540C")
BAD = HexColor("#B3261E")
S_PV = HexColor("#5B63C8")
S_EV = HexColor("#1F8F7A")
S_AC = HexColor("#D0592E")

SANS, SANS_B, MONO, MONO_B = "Helvetica", "Helvetica-Bold", "Courier", "Courier-Bold"

PAGE_W, PAGE_H = A4
MARGIN = 26
PAD = 14
X0 = MARGIN + PAD
X1 = PAGE_W - MARGIN - PAD
INNER = X1 - X0

ESTADO_COLOR = {
    EstadoEntregable.PENDIENTE: MUTED,
    EstadoEntregable.EN_REVISION: INK,
    EstadoEntregable.APROBADO: OK,
    EstadoEntregable.RECHAZADO: BAD,
}


# --------------------------------------------------------------------------- #
# Utilidades de dibujo
# --------------------------------------------------------------------------- #
def _num(v: Optional[float], dec: int = 0) -> str:
    if v is None:
        return "—"
    s = f"{v:,.{dec}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")  # formato es-CL


def _money(v: Optional[float], unidad: str) -> str:
    if v is None:
        return "—"
    if unidad == "USD":
        return f"US$ {_num(v, 2)}"
    if unidad == "CLP":
        return f"$ {_num(v)}"
    return f"{_num(v)} {unidad}"


def _corto(v: float) -> str:
    if abs(v) >= 1e6:
        return f"{_num(v / 1e6, 1)} M"
    if abs(v) >= 1e3:
        return f"{_num(v / 1e3, 1).rstrip('0').rstrip(',')} k"
    return _num(v)


def _fit(s: str, font: str, size: float, width: float) -> str:
    s = " ".join((s or "").split())
    if stringWidth(s, font, size) <= width:
        return s
    while s and stringWidth(s + "...", font, size) > width:
        s = s[:-1]
    return s.rstrip() + "..."


def _text(c, x, y, s, font=SANS, size=8.5, color=INK, anchor="l"):
    c.setFont(font, size)
    c.setFillColor(color)
    if anchor == "r":
        c.drawRightString(x, y, s)
    elif anchor == "c":
        c.drawCentredString(x, y, s)
    else:
        c.drawString(x, y, s)


def _eyebrow(c, x, y, s, color=MUTED):
    _text(c, x, y, s.upper(), MONO, 7, color)


def _seccion(c, y, letra, titulo) -> float:
    """Encabezado de detalle; devuelve la y bajo el título."""
    _eyebrow(c, X0, y, f"Detalle {letra}")
    _text(c, X0 + 48, y, titulo, SANS_B, 10.5)
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.line(X0, y - 5, X1, y - 5)
    return y - 17


def _sello(c, x, y, texto, color, size=8, anchor="l"):
    w = stringWidth(texto, MONO_B, size) + 10
    if anchor == "r":
        x -= w
    c.setStrokeColor(color)
    c.setLineWidth(1.2)
    c.rect(x, y - 3.5, w, size + 6, stroke=1, fill=0)
    _text(c, x + 5, y, texto, MONO_B, size, color)
    return w


# --------------------------------------------------------------------------- #
# Bloques
# --------------------------------------------------------------------------- #
def _marco(c):
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setStrokeColor(GRID)
    c.setLineWidth(0.3)
    paso = 14.17  # 5 mm
    x = MARGIN
    while x < PAGE_W - MARGIN:
        c.line(x, MARGIN, x, PAGE_H - MARGIN)
        x += paso
    y = MARGIN
    while y < PAGE_H - MARGIN:
        c.line(MARGIN, y, PAGE_W - MARGIN, y)
        y += paso
    c.setStrokeColor(INK)
    c.setLineWidth(1.6)
    c.rect(MARGIN, MARGIN, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN)
    c.setLineWidth(0.6)
    c.rect(MARGIN - 4, MARGIN - 4, PAGE_W - 2 * MARGIN + 8, PAGE_H - 2 * MARGIN + 8)


def _encabezado(c, p: Project, report: ValidationReport) -> float:
    top = PAGE_H - MARGIN
    c.setStrokeColor(INK)
    c.setLineWidth(1.6)
    c.line(MARGIN, top - 44, PAGE_W - MARGIN, top - 44)
    # Logo: cuadrícula 3x3 con punto rojo
    lx, ly = X0, top - 36
    c.setLineWidth(1.2)
    c.rect(lx, ly, 26, 26)
    c.setLineWidth(0.5)
    for k in (1, 2):
        c.line(lx + k * 26 / 3, ly, lx + k * 26 / 3, ly + 26)
        c.line(lx, ly + k * 26 / 3, lx + 26, ly + k * 26 / 3)
    c.setFillColor(REDLINE)
    c.circle(lx + 13, ly + 13, 2.8, stroke=0, fill=1)
    _text(c, lx + 36, top - 21, "PMBOK STUDIO", SANS_B, 14)
    _eyebrow(c, lx + 36, top - 32, "Kit oficial · informe ejecutivo")
    _text(c, X1, top - 21, "INFORME EJECUTIVO", SANS_B, 12, REDLINE, "r")
    corte = (f"Corte semana {p.evm.semana_corte}" if p.evm.modo == ModoEVM.LINEA_BASE else "Medición manual")
    _text(c, X1, top - 32, f"{corte} · emitido {date.today():%d/%m/%Y}".upper(), MONO, 7, MUTED, "r")

    # Proyecto + estado
    y = top - 66
    _text(c, X0, y, _fit(p.nombre, SANS_B, 15, INNER - 150), SANS_B, 15)
    if p.descripcion:
        _text(c, X0, y - 14, _fit(p.descripcion, SANS, 8.5, INNER - 215), SANS, 8.5, MUTED)
    color = BAD if report.errores else OK
    _sello(c, X1, y + 1, "NO CONFORME" if report.errores else "CONFORME", color, 9, "r")
    _text(c, X1, y - 14, f"{report.errores} no conformidades · {report.advertencias} observaciones",
          MONO, 7, MUTED, "r")
    return y - 32


def _indicadores(c, y, p: Project, report: ValidationReport) -> float:
    y = _seccion(c, y, "A", "Indicadores de valor ganado")
    r, u = report.evm, p.evm.unidad

    def estado(i, bajo, alto):
        if i is None:
            return "SIN DATOS", MUTED
        return (alto, OK) if i >= 1 else (bajo, BAD)

    spi_t, spi_c = estado(r.spi, "ATRASADO", "EN PLAZO" if r.spi == 1 else "ADELANTADO")
    cpi_t, cpi_c = estado(r.cpi, "SOBRECOSTO", "EN PRESUPUESTO" if r.cpi == 1 else "BAJO PRESUPUESTO")
    celdas = [
        ("BAC", _money(r.bac, u), None, INK),
        ("PV", _money(r.pv, u), None, INK),
        ("EV", _money(r.ev, u), f"{_num(r.porcentaje_avance, 1)} % de avance", INK),
        ("AC", _money(r.ac, u), None, INK),
        ("SPI = EV / PV", _num(r.spi, 2), spi_t, spi_c),
        ("CPI = EV / AC", _num(r.cpi, 2), cpi_t, cpi_c),
        ("EAC", _money(r.eac, u), "costo final estimado", INK),
        ("VAC", _money(r.vac, u), "desvío al cierre", INK),
    ]
    cw, ch = INNER / 4, 38
    c.setFillColor(WHITE)
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.rect(X0, y - 2 * ch, INNER, 2 * ch, stroke=1, fill=1)
    for i, (k, v, nota, color) in enumerate(celdas):
        col, fila = i % 4, i // 4
        x, top = X0 + col * cw, y - fila * ch
        if col:
            c.setStrokeColor(LINE)
            c.line(x, top, x, top - ch)
        _eyebrow(c, x + 7, top - 11, k)
        _text(c, x + 7, top - 25, v, MONO_B, 11, color if color is not INK else INK)
        if nota:
            _text(c, x + 7, top - 34, nota.upper() if color is not INK else nota, MONO, 6.5, color if color is not INK else MUTED)
    c.setStrokeColor(LINE)
    c.line(X0, y - ch, X1, y - ch)
    return y - 2 * ch - 18


def _curva_s(c, y, p: Project, report: ValidationReport) -> float:
    y = _seccion(c, y, "B", "Curva S" if p.evm.modo == ModoEVM.LINEA_BASE else "Medición al corte")
    u = p.evm.unidad
    h = 168
    if p.evm.modo != ModoEVM.LINEA_BASE:
        r = report.evm
        filas = [("BAC", r.bac, LINE), ("PV", r.pv, S_PV), ("EV", r.ev, S_EV), ("AC", r.ac, S_AC)]
        mx = max([v for _, v, _ in filas] + [1])
        for i, (k, v, col) in enumerate(filas):
            yy = y - 14 - i * 20
            _text(c, X0, yy, k, MONO_B, 8, MUTED)
            c.setFillColor(col)
            c.rect(X0 + 30, yy - 2, (INNER - 140) * v / mx, 8, stroke=0, fill=1)
            _text(c, X1, yy, _money(v, u), MONO, 8, INK, "r")
        return y - 4 * 20 - 18

    serie = serie_semanal(p)
    corte, ultima = p.evm.semana_corte, len(serie) - 1
    bac = report.evm.bac
    mx = max([bac] + [max(s["pv"], s["ev"] or 0, s["ac"] or 0) for s in serie] + [1]) * 1.05
    e = 10 ** len(str(int(mx))) / 10
    mx = next(k * e for k in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10) if mx <= k * e)
    ml, mr, mt, mb = 40, 70, 16, 18
    px0, px1, py0, py1 = X0 + ml, X1 - mr, y - h + mb, y - mt
    X = lambda w: px0 + (w / ultima) * (px1 - px0)  # noqa: E731
    Y = lambda v: py0 + (v / mx) * (py1 - py0)  # noqa: E731

    # Leyenda
    lx = X0
    for nombre, col, dash in (("PV · planificado", S_PV, True), ("EV · ganado", S_EV, False), ("AC · costo real", S_AC, False)):
        c.setStrokeColor(col)
        c.setLineWidth(1.8)
        c.setDash(4, 3) if dash else c.setDash()
        c.line(lx, y - 3, lx + 18, y - 3)
        c.setDash()
        _text(c, lx + 22, y - 5.5, nombre, SANS, 7.5)
        lx += 34 + stringWidth(nombre, SANS, 7.5)

    # Rejilla y ejes
    c.setLineWidth(0.4)
    for f in (0, 0.25, 0.5, 0.75, 1):
        v = f * mx
        c.setStrokeColor(LINE)
        c.line(px0, Y(v), px1, Y(v))
        _text(c, px0 - 5, Y(v) - 2.5, _corto(v), MONO, 6.5, MUTED, "r")
    paso = max(1, -(-ultima // 12))
    for w in range(0, ultima + 1, paso):
        _text(c, X(w), py0 - 10, str(w), MONO, 6.5, MUTED, "c")
    _text(c, px1, py0 - 18, "SEMANA", MONO, 6, MUTED, "r")
    c.setStrokeColor(INK)
    c.setLineWidth(0.9)
    c.line(px0, py0, px1, py0)
    # BAC
    c.setStrokeColor(MUTED)
    c.setLineWidth(0.6)
    c.setDash(1.5, 2)
    c.line(px0, Y(bac), px1, Y(bac))
    c.setDash()
    _text(c, px0 + 4, Y(bac) + 3, f"BAC {_corto(bac)}", MONO, 6.5, MUTED)
    # Corte
    c.setStrokeColor(INK)
    c.setDash(3, 2)
    c.line(X(corte), py0, X(corte), py1 + 4)
    c.setDash()
    _text(c, X(corte), py1 + 7, f"CORTE · SEM {corte}", MONO_B, 6.5, INK, "c")

    # Series
    etiquetas = []
    for k, col, dash, corto in (("pv", S_PV, True, "PV"), ("ev", S_EV, False, "EV"), ("ac", S_AC, False, "AC")):
        pts = [(X(s["semana"]), Y(s[k])) for s in serie if s[k] is not None]
        c.setStrokeColor(col)
        c.setLineWidth(1.6)
        c.setDash(4, 3) if dash else c.setDash()
        path = c.beginPath()
        path.moveTo(*pts[0])
        for pt in pts[1:]:
            path.lineTo(*pt)
        c.drawPath(path, stroke=1, fill=0)
        c.setDash()
        if k != "pv":
            c.setFillColor(col)
            c.circle(*pts[-1], 2.6, stroke=0, fill=1)
        ultimo = [s[k] for s in serie if s[k] is not None][-1]
        etiquetas.append([pts[-1][0], pts[-1][1], f"{corto} {_corto(ultimo)}", col])
    etiquetas.sort(key=lambda e: -e[1])
    for i in range(1, len(etiquetas)):
        if etiquetas[i - 1][1] - etiquetas[i][1] < 10:
            etiquetas[i][1] = etiquetas[i - 1][1] - 10
    for x, yy, t, col in etiquetas:
        c.setFillColor(col)
        c.rect(x + 5, yy - 2.5, 5, 5, stroke=0, fill=1)
        _text(c, x + 13, yy - 2.5, t, MONO_B, 7, INK)
    return y - h - 12


def _tabla(c, y, columnas, filas, alto=13.5):
    """columnas: [(titulo, ancho, align)], filas: [[(texto, font, color)]]"""
    x = X0
    for titulo, w, al in columnas:
        _text(c, x + (w - 4 if al == "r" else 3), y, titulo.upper(), MONO, 6.5, MUTED, "r" if al == "r" else "l")
        x += w
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.line(X0, y - 4, X1, y - 4)
    y -= 4
    for fila in filas:
        y -= alto
        x = X0
        for (titulo, w, al), (s, font, col) in zip(columnas, fila):
            s = _fit(s, font, 7.5, w - 7)
            _text(c, x + (w - 4 if al == "r" else 3), y + 4, s, font, 7.5, col, "r" if al == "r" else "l")
            x += w
        c.setStrokeColor(LINE)
        c.setLineWidth(0.4)
        c.line(X0, y, X1, y)
    return y


def _entregables(c, y, p: Project, max_filas=10) -> float:
    aprobados = sum(1 for d in p.dod if d.estado == EstadoEntregable.APROBADO)
    y = _seccion(c, y, "C", f"Entregables · {aprobados} de {len(p.dod)} aprobados")
    raci_a = {cod: next((r for r, v in fila.items() if v == "A"), "—") for cod, fila in p.raci.items()}
    cols = [("Cód.", 30, "l"), ("Entregable", 150, "l"), ("Responsable (R)", 88, "l"), ("Aprueba (A)", 88, "l"),
            ("Fin", 30, "r"), ("Presupuesto", 58, "r"), ("Estado", INNER - 444, "l")]
    filas = []
    for d in p.dod[:max_filas]:
        estado = d.estado.value.upper()
        if d.estado == EstadoEntregable.APROBADO and d.aprobacion:
            estado += f" S{d.aprobacion.semana_aprobacion}"
        filas.append([
            (d.codigo, MONO_B, REDLINE), (d.entregable, SANS, INK), (d.responsable, SANS, INK),
            (raci_a.get(d.codigo, "—"), SANS, INK),
            (f"S{d.fin_semana_plan}" if d.fin_semana_plan is not None else "—", MONO, MUTED),
            (_num(d.presupuesto), MONO, INK), (estado, MONO_B, ESTADO_COLOR[d.estado]),
        ])
    y = _tabla(c, y, cols, filas)
    if len(p.dod) > max_filas:
        _text(c, X0, y - 9, f"+ {len(p.dod) - max_filas} entregables más en la Matriz DoD.", MONO, 6.5, MUTED)
        y -= 9
    return y - 16


def _riesgos(c, y, p: Project, max_filas=4) -> float:
    altos = sorted(
        (r for r in p.riesgos if clasificar_impacto(puntaje_riesgo(r.gravedad, r.probabilidad)) == "Alto"),
        key=lambda r: -puntaje_riesgo(r.gravedad, r.probabilidad),
    )
    y = _seccion(c, y, "D", f"Riesgos de impacto alto · {len(altos)} de {len(p.riesgos)}")
    if not altos:
        _text(c, X0, y - 2, "Sin riesgos de impacto alto (puntaje >= 13).", SANS, 8, MUTED)
        return y - 20
    cols = [("Cód.", 30, "l"), ("Riesgo", 250, "l"), ("G x P", 44, "r"), ("Estrategia", 70, "l"), ("Responsable", INNER - 394, "l")]
    filas = [[
        (r.codigo, MONO_B, REDLINE), (r.descripcion, SANS, INK),
        (f"{r.gravedad}x{r.probabilidad}={puntaje_riesgo(r.gravedad, r.probabilidad)}", MONO_B, BAD),
        (r.tipo_estrategia.value, SANS_B, INK), (r.propietario, SANS, INK),
    ] for r in altos[:max_filas]]
    y = _tabla(c, y, cols, filas)
    if len(altos) > max_filas:
        _text(c, X0, y - 9, f"+ {len(altos) - max_filas} riesgos altos más en la Matriz de Riesgo.", MONO, 6.5, MUTED)
        y -= 9
    return y - 16


def _observaciones(c, y, report: ValidationReport, limite_y: float) -> float:
    items = [i for i in report.issues if i.severity != Severity.INFO]
    items.sort(key=lambda i: 0 if i.severity == Severity.ERROR else 1)
    y = _seccion(c, y, "E", "Hoja de observaciones")
    if not items:
        _text(c, X0, y - 2, "Sin no conformidades ni observaciones.", SANS, 8, OK)
        return y - 16
    cabe = max(1, int((y - limite_y) // 12))
    for n, i in enumerate(items[:cabe], 1):
        err = i.severity == Severity.ERROR
        etiqueta = f"{n:02d}  {'NO CONFORME' if err else 'OBSERVACIÓN'} · {i.code}"
        _text(c, X0, y - 2, etiqueta, MONO_B, 7, BAD if err else WARN)
        _text(c, X0 + 150, y - 2, _fit(i.message, SANS, 7.5, INNER - 150), SANS, 7.5, INK)
        y -= 12
    if len(items) > cabe:
        _text(c, X0, y - 2, f"+ {len(items) - cabe} más (ver validación en PMBOK Studio).", MONO, 6.5, MUTED)
        y -= 12
    return y


def _cajetin(c, p: Project, report: ValidationReport):
    h, y = 30, MARGIN
    c.setFillColor(PAPER)
    c.rect(MARGIN, y, PAGE_W - 2 * MARGIN, h, stroke=0, fill=1)
    c.setStrokeColor(INK)
    c.setLineWidth(1.6)
    c.line(MARGIN, y + h, PAGE_W - MARGIN, y + h)
    celdas = [
        ("Proyecto", _fit(p.nombre, SANS_B, 9, 200), SANS_B, INK, 220),
        ("BAC", _money(report.evm.bac, p.evm.unidad), MONO, INK, 90),
        ("Corte", f"SEM {p.evm.semana_corte:02d}" if p.evm.modo == ModoEVM.LINEA_BASE else "MANUAL", MONO, INK, 70),
        ("Estado", "NO CONFORME" if report.errores else "CONFORME", MONO_B, BAD if report.errores else OK, 80),
        ("Hoja", "INF-01", MONO_B, REDLINE, 0),
    ]
    x = MARGIN
    total = PAGE_W - 2 * MARGIN
    for i, (k, v, font, col, w) in enumerate(celdas):
        w = w or (MARGIN + total - x)
        _eyebrow(c, x + 7, y + h - 10, k)
        _text(c, x + 7, y + 7, v, font, 9, col)
        if i < len(celdas) - 1:
            c.setStrokeColor(INK)
            c.setLineWidth(0.6)
            c.line(x + w, y, x + w, y + h)
        x += w


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
def build_pdf(p: Project, report: ValidationReport) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Informe ejecutivo · {p.nombre}")
    c.setAuthor("PMBOK Studio")
    c.setSubject("Informe ejecutivo del proyecto")
    _marco(c)
    y = _encabezado(c, p, report)
    y = _indicadores(c, y, p, report)
    y = _curva_s(c, y, p, report)
    y = _entregables(c, y, p)
    y = _riesgos(c, y, p)
    _observaciones(c, y, report, limite_y=MARGIN + 30 + 14)
    _cajetin(c, p, report)
    c.showPage()
    c.save()
    return buf.getvalue()
