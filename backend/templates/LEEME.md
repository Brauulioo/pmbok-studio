# Plantillas originales (opcional)

Esta carpeta es para las plantillas Excel originales del curso u organización.
No se suben al repositorio (ver `.gitignore`).

Si existen, el exportador las usa en lugar de las plantillas propias de
`backend/templates_base/`. Deben llamarse exactamente:

| Archivo | Hoja que se completa |
|---|---|
| `Plantilla Matriz DoD.xlsx` | `Planilla` |
| `PMOinformatica Plantilla Matriz RACI.xls.xlsx` | `Recursos x Actividad` |
| `Matriz de Riesgo.xlsx` | `Registro` |
| `Matriz de KPIs.xlsx` | `Matriz` |

`GET /api/health` indica qué origen se está usando para cada matriz (`original` o `base`).
