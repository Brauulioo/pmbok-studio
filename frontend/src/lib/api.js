// Cliente del backend FastAPI. Si no está disponible (p. ej. en la vista previa
// como Artifact), la app sigue funcionando con los presets incluidos y JSON.

import { normalizeProject, presetToProject, toPayload } from './pmbok';

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

async function request(path, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${API_URL}${path}`, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function checkHealth() {
  try {
    const r = await request('/api/health', {}, 2500);
    if (!r.ok) return { online: false };
    const data = await r.json();
    return { online: true, faltantes: data.plantillas_faltantes ?? [] };
  } catch {
    return { online: false };
  }
}

/** Presets del backend; si viene en formato del JSON crudo también lo acepta. */
export async function fetchPresets() {
  const r = await request('/api/presets', {}, 4000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return data.map((p) => (p.dod_items ? presetToProject(p) : normalizeProject(p)));
}

export async function validateRemote(project) {
  const r = await request('/api/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toPayload(project)),
  });
  if (!r.ok) throw new Error(await describeError(r));
  return r.json();
}

/**
 * Devuelve { ok: true, blob, filename } o { ok: false, status, report?, message }.
 * Lanza TypeError si el backend no responde (red / CORS / CSP).
 */
export async function exportZip(project, forzar = false) {
  const r = await request(`/api/export-zip${forzar ? '?forzar=true' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toPayload(project)),
  }, 60000);
  if (r.ok) {
    const cd = r.headers.get('Content-Disposition') ?? '';
    const m = /filename="([^"]+)"/.exec(cd);
    return { ok: true, blob: await r.blob(), filename: m?.[1] ?? 'matrices_PMBOK.zip' };
  }
  if (r.status === 422) {
    const body = await r.json();
    if (body.report) return { ok: false, status: 422, report: body.report, message: body.detail };
    return { ok: false, status: 422, message: formatPydanticErrors(body.detail) };
  }
  return { ok: false, status: r.status, message: await describeError(r) };
}

/** Informe ejecutivo PDF (se emite aunque haya errores; los lista en la hoja de observaciones). */
export async function exportReportPdf(project) {
  const r = await request('/api/report-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toPayload(project)),
  }, 60000);
  if (!r.ok) return { ok: false, status: r.status, message: await describeError(r) };
  const m = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '');
  return { ok: true, blob: await r.blob(), filename: m?.[1] ?? 'informe_ejecutivo.pdf' };
}

async function describeError(r) {
  try {
    const body = await r.json();
    return typeof body.detail === 'string' ? body.detail : formatPydanticErrors(body.detail);
  } catch {
    return `Error HTTP ${r.status}`;
  }
}

function formatPydanticErrors(detail) {
  if (!Array.isArray(detail)) return 'Datos inválidos.';
  return detail.slice(0, 4).map((e) => `${(e.loc ?? []).slice(1).join('.')}: ${e.msg}`).join(' · ');
}

/**
 * Guarda un archivo. Dentro de un Artifact de claude.ai usa la capacidad
 * `downloads` (los enlaces <a download> están bloqueados ahí); en local usa un enlace.
 */
export async function saveFile(filename, data) {
  const downloads = await window.claude?.use?.('downloads').catch(() => null);
  if (downloads) {
    await downloads.save({ filename, data });
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --------------------------------------------------------------------------
// Proyectos guardados (SQLite en el backend, con revisiones)
// --------------------------------------------------------------------------
async function json(path, options = {}) {
  const r = await request(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? `Error HTTP ${r.status}`);
    err.status = r.status;
    err.detail = body?.detail;
    throw err;
  }
  return body;
}

export const listProjects = () => json('/api/projects');
export const listRevisions = (id) => json(`/api/projects/${id}/revisions`);
export const deleteProject = (id) => json(`/api/projects/${id}`, { method: 'DELETE' });

export async function getProject(id, rev) {
  const data = await json(`/api/projects/${id}${rev ? `?rev=${rev}` : ''}`);
  return { ...data, project: normalizeProject(data.project) };
}

/** Crea el proyecto (sin id) o guarda una revisión nueva sobre `revBase`. Lanza err.status 409 si hay conflicto. */
export function saveProject(project, { id, revBase, nota = '' } = {}) {
  const body = JSON.stringify({ project: toPayload(project), nota, rev_base: revBase ?? null });
  return id ? json(`/api/projects/${id}`, { method: 'PUT', body }) : json('/api/projects', { method: 'POST', body });
}
