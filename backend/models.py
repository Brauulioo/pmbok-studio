"""
Modelos de dominio de PMBOK Studio (Pydantic v2).

Un `Project` unifica Equipo, DoD, RACI, Riesgos, KPIs y métricas EVM.

Convenciones (alineadas con build_presets.cjs):
- Los roles del equipo son claves exactas: DoD.responsable, RACI, Riesgo.propietario
  y KPI.responsable referencian `TeamMember.rol`.
- La RACI se indexa por código de entregable DoD, así cada actividad queda
  sincronizada con el DoD por construcción.
- Aquí viven solo las reglas estructurales (tipos, rangos, máximos). Las reglas
  PMBOK (un único 'A', R obligatorio, referencias cruzadas...) se reportan como
  issues desde services/pmbok_validator.py para no rechazar borradores.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_MIEMBROS_RACI = 10  # Columnas C..L de la plantilla RACI


class PMBOKModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, populate_by_name=True)


# --------------------------------------------------------------------------- #
# Enumeraciones
# --------------------------------------------------------------------------- #
RaciValue = Literal["R", "A", "C", "I", ""]


class TipoRiesgo(str, Enum):
    AMENAZA = "Amenaza"
    OPORTUNIDAD = "Oportunidad"


class EstrategiaRiesgo(str, Enum):
    EVITAR = "Evitar"
    MITIGAR = "Mitigar"
    TRANSFERIR = "Transferir"
    ACEPTAR = "Aceptar"
    EXPLOTAR = "Explotar"
    COMPARTIR = "Compartir"
    MEJORAR = "Mejorar"


ESTRATEGIAS_PERMITIDAS: dict[TipoRiesgo, set[EstrategiaRiesgo]] = {
    TipoRiesgo.AMENAZA: {
        EstrategiaRiesgo.EVITAR,
        EstrategiaRiesgo.MITIGAR,
        EstrategiaRiesgo.TRANSFERIR,
        EstrategiaRiesgo.ACEPTAR,
    },
    TipoRiesgo.OPORTUNIDAD: {
        EstrategiaRiesgo.EXPLOTAR,
        EstrategiaRiesgo.COMPARTIR,
        EstrategiaRiesgo.MEJORAR,
    },
}


class EstadoEntregable(str, Enum):
    PENDIENTE = "Pendiente"
    EN_REVISION = "En revisión"
    APROBADO = "Aprobado"
    RECHAZADO = "Rechazado"


class ModoEVM(str, Enum):
    LINEA_BASE = "linea_base"  # PV/EV/AC calculados desde entregables, aprobaciones y costos
    MANUAL = "manual"          # PV/AC/% avance ingresados a mano


class TipoIndicador(str, Enum):
    ADELANTADO = "Adelantado"
    REZAGADO = "Rezagado"


class Severity(str, Enum):
    ERROR = "error"      # Bloquea validar / exportar como versión aprobada
    WARNING = "warning"  # Recomienda revisión, no bloquea
    INFO = "info"


Section = Literal["proyecto", "equipo", "dod", "raci", "riesgos", "kpis", "evm"]


# --------------------------------------------------------------------------- #
# Equipo
# --------------------------------------------------------------------------- #
class TeamMember(PMBOKModel):
    rol: str = Field(..., min_length=1, max_length=120, description="Clave única del integrante")
    nombre: Optional[str] = Field(None, max_length=120, description="Persona asignada (opcional)")
    email: Optional[str] = Field(None, max_length=200)

    @property
    def etiqueta(self) -> str:
        """Texto de la cabecera RACI (fila 6)."""
        return f"{self.nombre} ({self.rol})" if self.nombre else self.rol


# --------------------------------------------------------------------------- #
# DoD
# --------------------------------------------------------------------------- #
class Evidencia(PMBOKModel):
    url: str = Field(..., min_length=1, description="Ruta del repositorio o enlace verificable (commit, PR, informe)")
    descripcion: str = ""
    semana: Optional[int] = Field(None, ge=0)


class Aprobacion(PMBOKModel):
    rol_aprobador: str = Field(..., min_length=1, description="Debe ser el rol con 'A' en la RACI")
    semana_aprobacion: int = Field(..., ge=0)
    fecha: Optional[date] = None
    comentario: str = ""


class DoDItem(PMBOKModel):
    codigo: str = Field(..., min_length=1, max_length=30, examples=["E1"])
    entregable: str = Field(..., min_length=1, max_length=300)
    criterio_aceptacion: str = Field(..., min_length=1)
    responsable: str = Field(..., min_length=1, description="Rol del equipo (debe ser el R en la RACI)")
    fecha_entrega: Optional[date] = None
    evidencia: str = Field("", description="Evidencia esperada (texto del DoD)")

    # Flujo de aprobación
    estado: EstadoEntregable = EstadoEntregable.PENDIENTE
    evidencia_registrada: list[Evidencia] = Field(default_factory=list)
    aprobacion: Optional[Aprobacion] = None
    comentario_revision: str = Field("", description="Motivo del último rechazo")

    # Línea base del paquete de trabajo (EVM / cronograma)
    presupuesto: float = Field(0, ge=0)
    inicio_semana_plan: Optional[int] = Field(None, ge=0)
    fin_semana_plan: Optional[int] = Field(None, ge=0)


# --------------------------------------------------------------------------- #
# Riesgos
# --------------------------------------------------------------------------- #
class Riesgo(PMBOKModel):
    codigo: str = Field(..., min_length=1, max_length=30, examples=["R1"])
    tipo: TipoRiesgo
    descripcion: str = Field(..., min_length=1)
    gravedad: int = Field(..., ge=1, le=5)
    probabilidad: int = Field(..., ge=1, le=5)
    tipo_estrategia: EstrategiaRiesgo
    estrategia: str = Field(..., min_length=1, description="Descripción de la respuesta")
    propietario: str = Field(..., min_length=1, description="Rol del equipo")
    fecha_revision: Optional[date] = None
    entregables_afectados: list[str] = Field(default_factory=list)
    disparador: str = ""
    justificacion_aceptacion: Optional[str] = None


# --------------------------------------------------------------------------- #
# KPIs
# --------------------------------------------------------------------------- #
class KPIMeta(PMBOKModel):
    tipo: str = Field(..., examples=["Minimo", "Minimo_referenciado", "Referencia_inicial"])
    valor: Optional[float] = None
    referencia: Optional[str] = None
    revision: Optional[str] = None
    meta_cierre: Optional[float] = None


class MedicionKPI(PMBOKModel):
    semana: int = Field(..., ge=0)
    valor: float
    nota: str = ""


class KPI(PMBOKModel):
    codigo: str = Field(..., min_length=1, max_length=30, examples=["K1", "KPI1"])
    nombre: str = Field(..., min_length=1)
    tipo_indicador: TipoIndicador
    definicion: str = ""
    formula: str = ""
    unidad: str = ""
    metodo_medicion: Optional[str] = Field(
        None, description="Si se omite, el exportador lo compone con formula + fuente"
    )
    meta: Union[KPIMeta, str]
    fuente: str = ""
    responsable: str = Field(..., min_length=1, description="Rol del equipo")
    frecuencia: str = Field(..., min_length=1)
    valor_actual: Optional[float] = None
    mediciones: list[MedicionKPI] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# EVM
# --------------------------------------------------------------------------- #
class CostoRegistro(PMBOKModel):
    id: str = Field(..., min_length=1)
    entregable_codigo: str = Field(..., min_length=1)
    semana: int = Field(..., ge=0)
    importe: float = Field(..., ge=0)
    descripcion: str = ""


class EVMInput(PMBOKModel):
    """
    En modo `linea_base` bac/pv/ac/porcentaje_avance se recalculan desde el DoD
    (presupuesto, fin_semana_plan, aprobaciones) y `registro_costos`; los valores
    enviados se ignoran. En modo `manual` se usan tal cual.
    """
    modo: ModoEVM = ModoEVM.MANUAL
    semana_corte: int = Field(0, ge=0)
    registro_costos: list[CostoRegistro] = Field(default_factory=list)
    bac: float = Field(0, ge=0, description="Budget At Completion")
    pv: float = Field(0, ge=0, description="Planned Value al corte")
    ac: float = Field(0, ge=0, description="Actual Cost al corte")
    porcentaje_avance: float = Field(0, ge=0, le=100, description="% de avance real")
    unidad: str = "UM"


# --------------------------------------------------------------------------- #
# Proyecto
# --------------------------------------------------------------------------- #
class Project(PMBOKModel):
    id: Optional[str] = None
    nombre: str = Field(..., min_length=1, max_length=200)
    descripcion: str = ""
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None

    equipo: list[TeamMember] = Field(..., min_length=1, max_length=MAX_MIEMBROS_RACI)
    dod: list[DoDItem] = Field(default_factory=list)
    raci: dict[str, dict[str, RaciValue]] = Field(
        default_factory=dict,
        description="{codigo_dod: {rol: 'R'|'A'|'C'|'I'|''}}",
    )
    riesgos: list[Riesgo] = Field(default_factory=list)
    kpis: list[KPI] = Field(default_factory=list)
    evm: EVMInput

    @field_validator("raci", mode="before")
    @classmethod
    def _normalizar_raci(cls, v):
        if isinstance(v, dict):
            return {
                cod: {rol: ("" if val is None else str(val).strip().upper()) for rol, val in (fila or {}).items()}
                for cod, fila in v.items()
            }
        return v

    @property
    def roles(self) -> list[str]:
        return [m.rol for m in self.equipo]


# --------------------------------------------------------------------------- #
# Resultados de validación
# --------------------------------------------------------------------------- #
class ValidationIssue(PMBOKModel):
    severity: Severity
    section: Section
    code: str = Field(..., examples=["RACI-01", "KPI-03"])
    message: str
    ref: Optional[str] = None


class EVMResult(PMBOKModel):
    """Valores sin redondear: redondear solo al mostrar. None = no calculable."""
    modo: ModoEVM
    semana_corte: int
    bac: float
    pv: float
    ac: float
    porcentaje_avance: float
    ev: float
    sv: float
    cv: float
    spi: Optional[float]
    cpi: Optional[float]
    eac: Optional[float]
    etc: Optional[float]
    vac: Optional[float]
    tcpi: Optional[float]
    estado_cronograma: str
    estado_costo: str


class RiskAssessment(PMBOKModel):
    codigo: str
    puntaje: int
    impacto: Literal["Bajo", "Medio", "Alto"]
    gravedad_label: str
    probabilidad_label: str
    estrategia_label: str


class ValidationReport(PMBOKModel):
    valid: bool
    errores: int
    advertencias: int
    issues: list[ValidationIssue]
    evm: EVMResult
    riesgos: list[RiskAssessment]
