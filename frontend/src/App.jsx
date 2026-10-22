import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit, Calculator, CircleCheck, CircleX, Cpu, Download, FileArchive, FileJson, FilePlus2, FileText, FolderOpen, Globe, History, Link2, Save,
  LoaderCircle, Plus, RotateCcw, Send, Server, ServerOff, Stamp, Table2, Trash2, TriangleAlert, Undo2, Upload, X,
} from 'lucide-react';
import {
  BUNDLED_PRESETS, ESTRATEGIAS, GRAVEDAD, MAX_EQUIPO, MONEDAS, PROBABILIDAD, addCost, addDod, addEvidence,
  aprobadoAlCorte, approveDod, calcEVM, cycleRaci, emptyProject, formatMeta, formatMoney, kpiMetodo, nextCode,
  normalizeProject, presetToProject, raciRowStatus, rejectDod, removeCost, removeDod, removeEvidence, removeRole,
  renameRole, reopenDod, resolveEVM, riskLevel, riskScore, rolAccountable, sendToReview, toPayload, updateDod,
  serieSemanal, validateProject, addMedicion, removeMedicion, evaluarKPI, evaluarMedicion, medicionAutomatica,
} from './lib/pmbok';
import {
  API_URL, checkHealth, deleteProject, exportReportPdf, exportZip, fetchPresets, getProject, listProjects, listRevisions,
  saveFile, saveProject,
} from './lib/api';

const DRAFT_KEY = 'pmbok-studio:draft';
const PRESET_ICONS = { 'web-saas-full-stack': Globe, 'iot-hardware-cloud': Cpu, 'datos-ia-analytics': BrainCircuit };
const PRESET_SHORT = { 'web-saas-full-stack': 'App Web / SaaS', 'iot-hardware-cloud': 'Sistema IoT', 'datos-ia-analytics': 'Proyecto IA/Datos' };

// Cada pestaña es una lámina del juego de planos
const LAMINAS = [
  { id: 'inicio', code: 'L-01', label: 'Inicio y equipo', sections: ['proyecto', 'equipo'] },
  { id: 'alcance', code: 'L-02', label: 'Alcance + RACI', sections: ['dod', 'raci'] },
  { id: 'riesgos', code: 'L-03', label: 'Riesgos 5×5', sections: ['riesgos'] },
  { id: 'kpis', code: 'L-04', label: 'KPIs + EVM', sections: ['kpis', 'evm'] },
];
const laminaForSection = (s) => LAMINAS.find((t) => t.sections.includes(s))?.id ?? 'inicio';

const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'proyecto';
const fmtNum = (v, d = 2) => (v == null ? '—' : new Intl.NumberFormat('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v));

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return normalizeProject(JSON.parse(raw));
  } catch { /* almacenamiento no disponible */ }
  return BUNDLED_PRESETS[0];
}

// Proyecto guardado en el backend al que corresponde el borrador: { id, rev, base }
// `base` es el JSON de la revisión guardada, para saber si hay cambios sin guardar.
const DOC_KEY = 'pmbok-studio:doc';
function loadDoc() {
  try {
    return JSON.parse(localStorage.getItem(DOC_KEY)) ?? null;
  } catch {
    return null;
  }
}

// ===========================================================================
// App
// ===========================================================================
export default function App() {
  const [project, setProject] = useState(loadDraft);
  const [tab, setTab] = useState('inicio');
  const [presets, setPresets] = useState(BUNDLED_PRESETS);
  const [presetSource, setPresetSource] = useState('bundled');
  const [backend, setBackend] = useState({ status: 'checking' });
  const [panel, setPanel] = useState(null); // null | { report?, offline? }
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [doc, setDoc] = useState(loadDoc);
  const [proyectosOpen, setProyectosOpen] = useState(false);
  const fileRef = useRef(null);

  const issues = useMemo(() => validateProject(project), [project]);
  const errores = issues.filter((i) => i.severity === 'error').length;
  const advertencias = issues.filter((i) => i.severity === 'warning').length;
  const lamina = LAMINAS.find((l) => l.id === tab);
  const snapshot = useMemo(() => JSON.stringify(toPayload(project)), [project]);
  const dirty = !doc || doc.base !== snapshot;

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(project)); } catch { /* sin almacenamiento */ }
  }, [project]);
  useEffect(() => {
    try { localStorage.setItem(DOC_KEY, JSON.stringify(doc)); } catch { /* sin almacenamiento */ }
  }, [doc]);

  /** Reemplaza el proyecto en edición; `nuevoDoc` = null si no está guardado en el servidor. */
  const abrirProyecto = (p, nuevoDoc = null) => {
    setProject(p);
    setDoc(nuevoDoc ? { ...nuevoDoc, base: nuevoDoc.base ?? JSON.stringify(toPayload(p)) } : null);
  };

  const handleSave = async (nota = '') => {
    setBusy(true);
    try {
      const res = await saveProject(project, { id: doc?.id, revBase: doc?.rev, nota });
      setDoc({ id: res.id, rev: res.rev, base: snapshot });
      setBackend((b) => (b.status === 'online' ? b : { status: 'online', faltantes: [] }));
      toast('ok', doc ? `Guardado como revisión ${res.rev}` : `Proyecto guardado en el servidor (Rev. ${res.rev})`);
      return true;
    } catch (e) {
      if (e.status === 409) {
        toast('bad', `${e.message} Abre la revisión ${e.detail?.rev_actual} desde Proyectos o guarda como proyecto nuevo.`);
        setProyectosOpen(true);
      } else if (e.status) {
        toast('bad', e.message);
      } else {
        setBackend({ status: 'offline' });
        toast('bad', 'Sin conexión con el backend: el proyecto sigue guardado solo en este navegador.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toast = (tone, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };

  const probeBackend = async () => {
    setBackend({ status: 'checking' });
    const h = await checkHealth();
    if (!h.online) {
      setBackend({ status: 'offline' });
      return false;
    }
    setBackend({ status: 'online', faltantes: h.faltantes });
    try {
      setPresets(await fetchPresets());
      setPresetSource('backend');
    } catch { /* se mantienen los presets incluidos */ }
    return true;
  };

  useEffect(() => { probeBackend(); }, []);

  /** Guarda el estado actual como un proyecto nuevo (p. ej. tras un conflicto de revisiones). */
  const handleSaveNew = async (nota = '') => {
    setBusy(true);
    try {
      const res = await saveProject(project, { nota });
      setDoc({ id: res.id, rev: res.rev, base: snapshot });
      toast('ok', 'Guardado como proyecto nuevo (Rev. 1)');
      return true;
    } catch (e) {
      toast('bad', e.message ?? 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const loadPreset = (p, msg) => {
    abrirProyecto(structuredClone(p));
    toast('ok', msg ?? `Preset cargado: ${p.nombre}`);
  };

  const handleExportZip = async (forzar = false) => {
    setBusy(true);
    let res;
    try {
      res = await exportZip(project, forzar);
    } catch {
      setBackend({ status: 'offline' });
      setPanel({ offline: true });
      setBusy(false);
      return;
    }
    setBackend((b) => (b.status === 'online' ? b : { status: 'online', faltantes: [] }));
    if (res.ok) {
      try {
        await saveFile(res.filename, res.blob);
        toast('ok', 'Kit emitido: 4 matrices Excel + informe ejecutivo PDF');
        setPanel(null);
      } catch (e) {
        if (e?.code !== 'declined') toast('bad', `No se pudo guardar el archivo (${e?.code ?? e?.message ?? 'error'}).`);
      }
    } else if (res.report) {
      setPanel({ report: res.report });
      toast('warn', `El backend encontró ${res.report.errores} error(es). Revisa la hoja de observaciones.`);
    } else {
      toast('bad', res.message ?? `Error ${res.status}`);
    }
    setBusy(false);
  };

  const handleReportPdf = async () => {
    setBusy(true);
    let res;
    try {
      res = await exportReportPdf(project);
    } catch {
      setBackend({ status: 'offline' });
      setPanel({ offline: true });
      setBusy(false);
      return;
    }
    if (res.ok) {
      try {
        await saveFile(res.filename, res.blob);
        toast('ok', 'Informe ejecutivo descargado');
      } catch (e) {
        if (e?.code !== 'declined') toast('bad', `No se pudo guardar el PDF (${e?.code ?? e?.message ?? 'error'}).`);
      }
    } else {
      toast('bad', res.message ?? `Error ${res.status}`);
    }
    setBusy(false);
  };

  const handleExportJson = async () => {
    try {
      await saveFile(`${slugify(project.nombre)}.json`, JSON.stringify(toPayload(project), null, 2));
      toast('ok', 'Proyecto exportado como JSON');
    } catch (e) {
      if (e?.code !== 'declined') toast('bad', `No se pudo guardar el JSON (${e?.code ?? 'error'}).`);
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const p = data.dod_items ? presetToProject(data) : data;
      if (!Array.isArray(p.equipo) || !Array.isArray(p.dod) || typeof p.evm !== 'object') throw new Error('formato');
      abrirProyecto(normalizeProject({ ...emptyProject(), ...p }));
      toast('ok', `Proyecto importado: ${p.nombre ?? file.name}`);
    } catch {
      toast('bad', 'El archivo no es un proyecto de PMBOK Studio válido (se esperaba equipo, dod y evm).');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const counts = (l) => {
    const xs = issues.filter((i) => l.sections.includes(i.section));
    return { e: xs.filter((i) => i.severity === 'error').length, w: xs.filter((i) => i.severity === 'warning').length };
  };

  return (
    <div className="gutter min-h-full py-5 lg:py-7">
      <div className="hoja mx-auto my-1.5 flex max-w-[1480px] flex-col">
        {/* Encabezado de la lámina */}
        <header className="flex flex-wrap items-stretch border-b-2 border-fg">
          <div className="flex items-center gap-3.5 border-r border-fg px-5 py-4">
            <Logo />
            <div>
              <div className="font-display text-[22px] font-bold leading-none tracking-[0.02em]">PMBOK STUDIO</div>
              <div className="mt-1 font-mono text-[10.5px] tracking-[0.1em] text-muted">JUEGO DE 4 LÁMINAS · KIT OFICIAL</div>
            </div>
          </div>
          <nav className="flex min-w-0 flex-[1_1_520px] flex-wrap" aria-label="Láminas">
            {LAMINAS.map((l, i) => {
              const c = counts(l);
              const active = tab === l.id;
              return (
                <button
                  key={l.id}
                  onClick={() => setTab(l.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[60px] flex-[1_1_150px] flex-col items-start justify-center px-4 py-2.5 text-left ${i < LAMINAS.length - 1 ? 'border-r border-line' : ''} ${active ? 'bg-surface shadow-[inset_0_-3px_0_var(--redline)]' : 'hover:bg-surface/60'}`}
                >
                  <span className="flex w-full items-center justify-between gap-2 font-mono text-[11.5px]">
                    <span className={active ? 'text-redline' : 'text-muted'}>{l.code}</span>
                    <IssueMarks e={c.e} w={c.w} />
                  </span>
                  <span className={`font-display text-[16px] leading-tight ${active ? 'font-bold' : 'font-semibold'}`}>{l.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex items-center border-l-2 border-fg px-4 py-3">
            <button
              onClick={() => handleExportZip(false)}
              disabled={busy}
              className="flex min-h-[44px] items-center gap-2.5 bg-accent px-4 font-display text-[15px] font-bold tracking-[0.04em] text-accent-fg transition-colors hover:bg-accent-strong disabled:opacity-60"
            >
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <FileArchive size={16} />}
              EMITIR KIT (.ZIP)
            </button>
          </div>
        </header>

        {/* Franja de estado */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-fg px-5 py-2.5">
          <button
            onClick={() => setPanel((p) => (p ? null : {}))}
            className={`sello ${errores ? 'bg-bad-soft text-bad' : advertencias ? 'bg-warn-soft text-warn' : 'text-ok'}`}
            title="Abrir hoja de observaciones"
          >
            {errores ? <CircleX size={13} /> : advertencias ? <TriangleAlert size={13} /> : <CircleCheck size={13} />}
            <span className="tnum">{errores ? `${errores} no conformes` : 'Conforme'} · {advertencias} observaciones</span>
          </button>
          <BackendStatus backend={backend} onRetry={probeBackend} />
          <div className="ml-auto flex flex-wrap gap-2">
            <input ref={fileRef} id="import-json" type="file" accept="application/json,.json" className="hidden" onChange={(e) => handleImport(e.target.files?.[0])} />
            <GhostButton icon={Save} onClick={() => handleSave()} disabled={busy || (doc && !dirty)}>
              {doc ? (dirty ? `Guardar rev. ${doc.rev + 1}` : `Guardado · rev. ${doc.rev}`) : 'Guardar en servidor'}
            </GhostButton>
            <GhostButton icon={FolderOpen} onClick={() => setProyectosOpen(true)}>Proyectos</GhostButton>
            <GhostButton icon={FileText} onClick={handleReportPdf} disabled={busy}>Informe PDF</GhostButton>
            <GhostButton icon={Upload} onClick={() => fileRef.current?.click()}>Importar JSON</GhostButton>
            <GhostButton icon={FileJson} onClick={handleExportJson}>Exportar JSON</GhostButton>
          </div>
        </div>

        <main className="flex-1 p-4 sm:p-6 lg:p-7">
          {tab === 'inicio' && (
            <InicioTab project={project} setProject={setProject} presets={presets} presetSource={presetSource} onLoadPreset={loadPreset} toast={toast} />
          )}
          {tab === 'alcance' && <AlcanceTab project={project} setProject={setProject} toast={toast} />}
          {tab === 'riesgos' && <RiesgosTab project={project} setProject={setProject} toast={toast} />}
          {tab === 'kpis' && <KpiEvmTab project={project} setProject={setProject} toast={toast} />}
        </main>

        <Cajetin project={project} lamina={lamina} errores={errores} backend={backend} doc={doc} dirty={dirty} />
      </div>

      {panel && (
        <IssuesPanel
          issues={issues}
          panel={panel}
          busy={busy}
          onClose={() => setPanel(null)}
          onGo={(s) => { setTab(laminaForSection(s)); setPanel(null); }}
          onForce={() => handleExportZip(true)}
          onExportJson={handleExportJson}
          onRetry={async () => { if (await probeBackend()) handleExportZip(false); }}
        />
      )}

      {proyectosOpen && (
        <ProyectosPanel
          project={project}
          doc={doc}
          dirty={dirty}
          busy={busy}
          onClose={() => setProyectosOpen(false)}
          onSave={handleSave}
          onOpen={(p, d) => { abrirProyecto(p, d); setProyectosOpen(false); }}
          onSaveAsNew={async (nota) => { setDoc(null); return handleSaveNew(nota); }}
          toast={toast}
        />
      )}

      <div
        className="pointer-events-none fixed bottom-0 right-0 z-50 flex flex-col items-end gap-2"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto max-w-sm border-[1.5px] px-4 py-2.5 font-mono text-[12.5px] shadow-lg ${toneClass(t.tone)}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

const toneClass = (tone) =>
  ({ ok: 'border-ok bg-ok-soft text-ok', warn: 'border-warn bg-warn-soft text-warn', bad: 'border-bad bg-bad-soft text-bad' })[tone] ??
  'border-fg bg-surface text-fg';

// ===========================================================================
// Piezas compartidas
// ===========================================================================
function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect x="1" y="1" width="32" height="32" fill="none" stroke="var(--fg)" strokeWidth="2" />
      <path d="M1 12H33M1 22H33M12 1V33M22 1V33" stroke="var(--fg)" strokeWidth="1" />
      <circle cx="17" cy="17" r="3.5" fill="var(--redline)" />
    </svg>
  );
}

function IssueMarks({ e, w }) {
  if (!e && !w) return null;
  return (
    <span className="flex items-center gap-1 text-[10.5px]">
      {e > 0 && <span className="bg-bad px-1.5 text-white">{e}</span>}
      {w > 0 && <span className="border border-warn px-1 text-warn">{w}</span>}
    </span>
  );
}

function BackendStatus({ backend, onRetry }) {
  const map = {
    checking: { icon: LoaderCircle, text: 'Conectando con el backend…', cls: 'animate-spin', color: 'text-muted' },
    online: { icon: Server, text: 'Backend conectado', color: 'text-ok' },
    offline: { icon: ServerOff, text: 'Backend sin conexión', color: 'text-bad' },
  };
  const s = map[backend.status];
  const Icon = s.icon;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px]">
      <span className={`flex items-center gap-1.5 ${s.color}`}><Icon size={13} className={s.cls} />{s.text}</span>
      <span className="text-muted">{API_URL}</span>
      {backend.status === 'online' && backend.faltantes?.length > 0 && (
        <span className="text-warn">Faltan plantillas: {backend.faltantes.join(', ')}</span>
      )}
      {backend.status === 'offline' && (
        <button onClick={onRetry} className="flex items-center gap-1 text-fg underline underline-offset-2">
          <RotateCcw size={11} /> Reintentar
        </button>
      )}
    </div>
  );
}

function Cajetin({ project, lamina, errores, backend, doc, dirty }) {
  const idx = LAMINAS.indexOf(lamina) + 1;
  const celda = 'border-fg px-3 py-2';
  const k = 'font-mono text-[10.5px] tracking-[0.08em] text-muted';
  return (
    <footer className="grid grid-cols-2 border-t-2 border-fg sm:grid-cols-[minmax(0,2.4fr)_repeat(5,minmax(0,1fr))]">
      <div className={`${celda} col-span-2 border-b sm:col-span-1 sm:border-b-0 sm:border-r`}>
        <div className={k}>PROYECTO</div>
        <div className="truncate font-display text-[17px] font-bold">{project.nombre || 'Sin nombre'}</div>
      </div>
      <div className={`${celda} border-r`}>
        <div className={k}>BAC</div>
        <div className="font-mono text-[13.5px] tnum">{formatMoney(resolveEVM(project).bac, project.evm.unidad)}</div>
      </div>
      <div className={`${celda} border-b sm:border-b-0 sm:border-r`}>
        <div className={k}>CORTE</div>
        <div className="font-mono text-[13.5px] tnum">{project.evm.modo === 'linea_base' ? `SEM ${String(project.evm.semana_corte).padStart(2, '0')}` : 'MANUAL'}</div>
      </div>
      <div className={`${celda} border-r`} title={doc ? (dirty ? 'Hay cambios sin guardar' : 'Guardado en el servidor') : 'No guardado en el servidor'}>
        <div className={k}>REV.</div>
        <div className="font-mono text-[13.5px] tnum">
          {doc ? `${doc.rev}${dirty ? ' *' : ''}` : 'BORRADOR'}
        </div>
      </div>
      <div className={`${celda} border-b sm:border-b-0 sm:border-r`}>
        <div className={k}>ESTADO</div>
        <div className={`font-mono text-[13.5px] ${errores ? 'text-bad' : 'text-ok'}`}>{errores ? 'NO CONFORME' : 'CONFORME'}</div>
      </div>
      <div className={celda}>
        <div className={k}>LÁMINA</div>
        <div className="font-mono text-[13.5px] font-semibold text-redline tnum">{String(idx).padStart(2, '0')} / 04 {backend.status === 'online' ? '' : '· sin API'}</div>
      </div>
    </footer>
  );
}

function GhostButton({ icon: Icon, children, ...props }) {
  return (
    <button {...props} className="flex min-h-[34px] items-center gap-1.5 border border-fg bg-surface px-3 text-[12.5px] font-medium text-fg transition-colors hover:bg-accent-soft">
      <Icon size={14} />
      {children}
    </button>
  );
}

/** Panel de detalle, como los detalles numerados de un plano. */
function Detalle({ letra, eyebrow, title, actions, children, className = '', flush = false }) {
  return (
    <section className={`min-w-0 border border-fg bg-surface ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-fg px-5 py-3.5">
        <div className="min-w-0">
          <div className="eyebrow">Detalle {letra}{eyebrow ? ` · ${eyebrow}` : ''}</div>
          <h2 className="mt-0.5 text-[24px] font-bold leading-[1.05]">{title}</h2>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

function Label({ htmlFor, children, hint }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
      {children}
      {hint && <span className="normal-case tracking-normal">{hint}</span>}
    </label>
  );
}

function SmallButton({ icon: Icon, children, tone = 'default', ...props }) {
  const cls = tone === 'primary'
    ? 'bg-accent text-accent-fg hover:bg-accent-strong'
    : tone === 'danger' ? 'border border-bad text-bad hover:bg-bad-soft' : 'border border-fg bg-surface hover:bg-accent-soft';
  return (
    <button {...props} className={`flex min-h-[34px] items-center gap-1.5 px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-40 ${cls}`}>
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button {...props} aria-label={label} title={label} className="p-1.5 text-muted transition-colors hover:bg-bad-soft hover:text-bad disabled:opacity-30">
      <Icon size={15} />
    </button>
  );
}

function Sello({ tone, children }) {
  const cls = { ok: 'text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', muted: 'text-muted', accent: 'text-fg', red: 'text-redline' }[tone];
  return <span className={`sello ${cls}`}>{children}</span>;
}

const RoleSelect = ({ id, value, roles, onChange, className = 'cell' }) => (
  <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
    {!roles.includes(value) && <option value={value}>{value || '— Selecciona —'} (no está en el equipo)</option>}
    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
  </select>
);

const TH = 'border-b-2 border-fg px-2 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted';
const TD = 'border-b border-line px-2 py-1.5 align-top';

// ===========================================================================
// L-01 · Inicio y equipo
// ===========================================================================
function InicioTab({ project, setProject, presets, presetSource, onLoadPreset, toast }) {
  const [confirmId, setConfirmId] = useState(null);
  const set = (patch) => setProject((p) => ({ ...p, ...patch }));
  const setEvm = (patch) => setProject((p) => ({ ...p, evm: { ...p.evm, ...patch } }));

  const commitRename = (oldRol, newRol) => {
    const nuevo = newRol.trim();
    if (nuevo === oldRol) return true;
    if (!nuevo) { toast('bad', 'El rol no puede quedar vacío.'); return false; }
    if (project.equipo.some((m) => m.rol === nuevo)) { toast('bad', `Ya existe el rol "${nuevo}".`); return false; }
    setProject((p) => renameRole(p, oldRol, nuevo));
    return true;
  };

  const addMember = () => {
    let n = project.equipo.length + 1;
    while (project.equipo.some((m) => m.rol === `Colaborador ${n}`)) n++;
    set({ equipo: [...project.equipo, { rol: `Colaborador ${n}`, nombre: null }] });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Detalle letra="A" eyebrow="Acta de constitución" title="Datos del proyecto">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="p-nombre">Nombre del proyecto</Label>
              <input id="p-nombre" className="field font-display text-[17px] font-semibold" value={project.nombre} onChange={(e) => set({ nombre: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="p-desc">Descripción</Label>
              <textarea id="p-desc" rows={2} className="field" value={project.descripcion} onChange={(e) => set({ descripcion: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="p-bac" hint="BAC">Presupuesto total</Label>
              <div className="flex gap-2">
                {project.evm.modo === 'linea_base' ? (
                  <output id="p-bac" className="field bg-paper font-mono tnum">{resolveEVM(project).bac}</output>
                ) : (
                  <input id="p-bac" type="number" min="0" step="any" className="field font-mono tnum" value={project.evm.bac} onChange={(e) => setEvm({ bac: Math.max(0, Number(e.target.value) || 0) })} />
                )}
                <select id="p-moneda" aria-label="Moneda" className="field w-24 shrink-0 font-mono" value={project.evm.unidad} onChange={(e) => setEvm({ unidad: e.target.value })}>
                  {[...new Set([...MONEDAS, project.evm.unidad])].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="mt-1 font-mono text-[12px] text-muted tnum">
                {project.evm.modo === 'linea_base'
                  ? `${formatMoney(resolveEVM(project).bac, project.evm.unidad)} · suma de la línea base (L-04)`
                  : formatMoney(project.evm.bac, project.evm.unidad)}
              </div>
            </div>
            <div>
              <Label htmlFor="p-inicio">Fecha de inicio</Label>
              <input id="p-inicio" type="date" className="field font-mono" value={project.fecha_inicio ?? ''} onChange={(e) => set({ fecha_inicio: e.target.value || null })} />
            </div>
          </div>
        </Detalle>

        <Detalle
          letra="B"
          eyebrow={`${project.equipo.length}/${MAX_EQUIPO} integrantes`}
          title="Equipo del proyecto"
          actions={<SmallButton icon={Plus} onClick={addMember} disabled={project.equipo.length >= MAX_EQUIPO}>Agregar integrante</SmallButton>}
        >
          <p className="mb-4 max-w-prose text-[13px] text-muted">
            Cada rol ocupa una columna de la matriz RACI (C a L en la plantilla, máximo 10). Renombrar un rol actualiza el DoD, la RACI, los riesgos y los KPIs.
          </p>
          <div className="flex flex-col gap-2">
            {project.equipo.map((m, i) => (
              <RoleRow
                key={`${i}-${m.rol}`}
                index={i}
                member={m}
                canRemove={project.equipo.length > 1}
                onRename={(nuevo) => commitRename(m.rol, nuevo)}
                onNombre={(nombre) => set({ equipo: project.equipo.map((x, j) => (j === i ? { ...x, nombre: nombre || null } : x)) })}
                onRemove={() => setProject((p) => removeRole(p, m.rol))}
              />
            ))}
          </div>
        </Detalle>
      </div>

      <Detalle letra="C" eyebrow={presetSource === 'backend' ? 'Servidos por el backend' : 'Incluidos (sin backend)'} title="Presets universitarios">
        <p className="mb-4 text-[13px] text-muted">Rellenan equipo, DoD, RACI, riesgos, KPIs y línea base EVM para probar el flujo completo.</p>
        <div className="flex flex-col gap-3">
          {presets.map((p) => {
            const Icon = PRESET_ICONS[p.id] ?? Table2;
            const activo = project.id === p.id;
            return (
              <div key={p.id} className={`border p-3.5 ${activo ? 'border-2 border-fg bg-accent-soft/60' : 'border-line bg-paper'}`}>
                <div className="flex items-start gap-3">
                  <div className="border border-fg p-2"><Icon size={19} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[17px] font-bold">{PRESET_SHORT[p.id] ?? p.nombre}</span>
                      {activo && <Sello tone="red">En uso</Sello>}
                    </div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{p.descripcion}</div>
                    <div className="mt-1.5 font-mono text-[11px] text-muted tnum">
                      {p.equipo.length} roles · {p.dod.length} entregables · {p.riesgos.length} riesgos · {p.kpis.length} KPIs · BAC {formatMoney(resolveEVM(p).bac, p.evm.unidad)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  {confirmId === p.id ? (
                    <>
                      <SmallButton onClick={() => setConfirmId(null)}>Cancelar</SmallButton>
                      <SmallButton tone="primary" onClick={() => { onLoadPreset(p); setConfirmId(null); }}>Reemplazar proyecto actual</SmallButton>
                    </>
                  ) : (
                    <SmallButton icon={Download} onClick={() => setConfirmId(p.id)}>Cargar preset</SmallButton>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex justify-end pt-1">
            {confirmId === 'blank' ? (
              <div className="flex gap-2">
                <SmallButton onClick={() => setConfirmId(null)}>Cancelar</SmallButton>
                <SmallButton tone="primary" onClick={() => { onLoadPreset(emptyProject(), 'Proyecto en blanco'); setConfirmId(null); }}>Vaciar proyecto</SmallButton>
              </div>
            ) : (
              <SmallButton icon={FilePlus2} onClick={() => setConfirmId('blank')}>Empezar en blanco</SmallButton>
            )}
          </div>
        </div>
      </Detalle>
    </div>
  );
}

function RoleRow({ index, member, canRemove, onRename, onNombre, onRemove }) {
  const [rol, setRol] = useState(member.rol);
  const commit = () => { if (!onRename(rol)) setRol(member.rol); };
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <span className="grid h-8 w-8 place-items-center border border-fg font-mono text-[12px] font-semibold text-redline" title="Columna en la plantilla RACI">{String.fromCharCode(67 + index)}</span>
      <input
        id={`rol-${index}`}
        aria-label={`Rol ${index + 1}`}
        className="field"
        value={rol}
        onChange={(e) => setRol(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <input
        id={`persona-${index}`}
        aria-label={`Persona asignada al rol ${index + 1}`}
        placeholder="Persona (opcional)"
        className="field col-start-2 sm:col-start-auto"
        value={member.nombre ?? ''}
        onChange={(e) => onNombre(e.target.value)}
      />
      <div className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">
        <IconButton icon={Trash2} label={`Quitar ${member.rol}`} onClick={onRemove} disabled={!canRemove} />
      </div>
    </div>
  );
}

// ===========================================================================
// L-02 · Alcance (DoD) + RACI
// ===========================================================================
const CIRCLE = 'grid h-[34px] w-[34px] place-items-center rounded-full font-mono text-[14px] font-semibold';
const RACI_STYLE = {
  R: 'border-2 border-fg text-fg',
  A: 'bg-fg text-paper',
  C: 'border-[1.5px] border-dashed border-muted text-muted',
  I: 'border border-line text-muted font-normal',
  '': 'text-line',
};
const RACI_MEANING = { R: 'Ejecuta', A: 'Aprueba (único)', C: 'Consulta', I: 'Informa' };

function RaciSello({ fila, roles }) {
  const st = raciRowStatus(fila, roles);
  if (st.level === 'ok') return <Sello tone="ok">Conforme</Sello>;
  if (st.level === 'warn') return <Sello tone="warn">{st.label} · revisar</Sello>;
  return <Sello tone="bad">{st.label}</Sello>;
}

const ESTADO_TONE = { Pendiente: 'muted', 'En revisión': 'accent', Aprobado: 'ok', Rechazado: 'bad' };
const EstadoSello = ({ estado }) => <Sello tone={ESTADO_TONE[estado] ?? 'muted'}>{estado}</Sello>;

const VIEW_META = {
  dod: { letra: 'A', title: 'Definición de Terminado por entregable' },
  raci: { letra: 'B', title: 'Responsabilidades por entregable' },
  aprob: { letra: 'C', title: 'Revisión y aprobación de entregables' },
  crono: { letra: 'D', title: 'Cronograma de entregables' },
};

function AlcanceTab({ project, setProject, toast }) {
  const [view, setView] = useState('dod');
  const roles = project.equipo.map((m) => m.rol);
  const upd = (i, patch) => setProject((p) => updateDod(p, i, patch));
  const aprobados = project.dod.filter((d) => d.estado === 'Aprobado').length;

  const toggle = (
    <div className="flex flex-wrap border border-fg" role="tablist">
      {[['dod', 'Matriz DoD'], ['raci', 'Matriz RACI'], ['aprob', `Aprobaciones ${aprobados}/${project.dod.length}`], ['crono', 'Cronograma']].map(([id, label]) => (
        <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
          className={`min-h-[34px] px-3.5 font-display text-[14px] font-semibold ${view === id ? 'bg-accent text-accent-fg' : 'text-fg hover:bg-accent-soft'}`}>
          {label}
        </button>
      ))}
    </div>
  );
  const addBtn = <SmallButton icon={Plus} tone="primary" onClick={() => setProject(addDod)}>Agregar entregable</SmallButton>;

  return (
    <Detalle
      letra={VIEW_META[view].letra}
      eyebrow={`${project.dod.length} entregables · DoD ↔ RACI sincronizados`}
      title={VIEW_META[view].title}
      actions={<>{toggle}{addBtn}</>}
      flush
    >
      {project.dod.length === 0 ? (
        <div className="px-5 py-12 text-center text-muted">Aún no hay entregables. Agrega el primero o carga un preset en la lámina L-01.</div>
      ) : view === 'dod' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`${TH} w-20 pl-5`}>Código</th>
                <th className={`${TH} w-48`}>Entregable</th>
                <th className={TH}>Criterio de aceptación</th>
                <th className={`${TH} w-44`}>Responsable</th>
                <th className={`${TH} w-36`}>Fecha de entrega</th>
                <th className={`${TH} w-56`}>Evidencia / comprobación</th>
                <th className={`${TH} w-32`}>Control RACI</th>
                <th className={`${TH} w-10 pr-5`} />
              </tr>
            </thead>
            <tbody>
              {project.dod.map((d, i) => (
                <tr key={i}>
                  <td className={`${TD} pl-5`}><input id={`dod-cod-${i}`} aria-label="Código" className="cell font-mono font-semibold text-redline" value={d.codigo} onChange={(e) => upd(i, { codigo: e.target.value })} /></td>
                  <td className={TD}><textarea id={`dod-ent-${i}`} aria-label="Entregable" rows={2} className="cell font-medium" value={d.entregable} onChange={(e) => upd(i, { entregable: e.target.value })} /></td>
                  <td className={TD}><textarea id={`dod-crit-${i}`} aria-label="Criterio de aceptación" rows={3} className="cell" value={d.criterio_aceptacion} onChange={(e) => upd(i, { criterio_aceptacion: e.target.value })} /></td>
                  <td className={TD}><RoleSelect id={`dod-resp-${i}`} value={d.responsable} roles={roles} onChange={(v) => upd(i, { responsable: v })} /></td>
                  <td className={TD}><input id={`dod-fecha-${i}`} aria-label="Fecha de entrega" type="date" className="cell font-mono" value={d.fecha_entrega ?? ''} onChange={(e) => upd(i, { fecha_entrega: e.target.value || null })} /></td>
                  <td className={TD}><textarea id={`dod-ev-${i}`} aria-label="Evidencia" rows={3} className="cell" value={d.evidencia} onChange={(e) => upd(i, { evidencia: e.target.value })} /></td>
                  <td className={`${TD} py-2.5`}>
                    <div className="flex flex-col items-start gap-1.5">
                      <button onClick={() => setView('raci')} title="Ver en la matriz RACI"><RaciSello fila={project.raci[d.codigo]} roles={roles} /></button>
                      <button onClick={() => setView('aprob')} title="Ver aprobación"><EstadoSello estado={d.estado} /></button>
                    </div>
                  </td>
                  <td className={`${TD} pr-5`}><IconButton icon={Trash2} label={`Eliminar ${d.codigo}`} onClick={() => setProject((p) => removeDod(p, i))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === 'raci' ? (
        <RaciGrid project={project} setProject={setProject} roles={roles} />
      ) : view === 'crono' ? (
        <Gantt project={project} onSelect={() => setView('aprob')} />
      ) : (
        <Aprobaciones project={project} setProject={setProject} toast={toast} />
      )}
    </Detalle>
  );
}

/** Cronograma: barras inicio→fin planificados, estado del entregable, aprobación y semana de corte. */
function Gantt({ project, onSelect }) {
  const corte = project.evm.semana_corte;
  const conCorte = project.evm.modo === 'linea_base';
  const ultima = Math.max(
    1, conCorte ? corte : 0,
    ...project.dod.flatMap((d) => [d.fin_semana_plan ?? 0, d.inicio_semana_plan ?? 0, d.aprobacion?.semana_aprobacion ?? 0]),
  );
  const pos = (w) => `${(w / ultima) * 100}%`;
  const paso = Math.max(1, Math.ceil(ultima / 16));
  const semanas = Array.from({ length: ultima + 1 }, (_, w) => w);

  const estilo = (d) => {
    const atrasado = conCorte && d.fin_semana_plan != null && d.fin_semana_plan <= corte && !aprobadoAlCorte(d, corte);
    if (atrasado) return { cls: 'border-bad text-bad', bg: 'repeating-linear-gradient(135deg, var(--bad-soft) 0 5px, var(--surface) 5px 10px)', tag: 'Atrasado' };
    if (d.estado === 'Aprobado') return { cls: 'border-ok text-ok', bg: 'var(--ok-soft)', tag: null };
    if (d.estado === 'En revisión') return { cls: 'border-fg text-fg', bg: 'var(--accent-soft)', tag: null };
    if (d.estado === 'Rechazado') return { cls: 'border-bad text-bad', bg: 'var(--bad-soft)', tag: null };
    return { cls: 'border-fg text-fg', bg: 'var(--surface)', tag: null };
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Escala de semanas */}
          <div className="grid grid-cols-[230px_minmax(0,1fr)] border-b-2 border-fg">
            <div className="px-5 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Entregable</div>
            <div className="relative mr-6 h-8">
              {semanas.filter((w) => w % paso === 0).map((w) => (
                <span key={w} className="absolute bottom-1.5 -translate-x-1/2 font-mono text-[10.5px] text-muted tnum" style={{ left: pos(w) }}>{w}</span>
              ))}
            </div>
          </div>

          <div className="relative">
            {/* Rejilla semanal y línea de corte, comunes a todas las filas */}
            <div className="pointer-events-none absolute inset-y-0 left-[230px] right-6" aria-hidden="true">
              {semanas.map((w) => <div key={w} className="absolute inset-y-0 border-l border-line/70" style={{ left: pos(w) }} />)}
              {conCorte && (
                <div className="absolute inset-y-0 border-l-[1.5px] border-dashed border-fg" style={{ left: pos(corte) }}>
                  <span className="absolute -top-0.5 left-1 whitespace-nowrap bg-paper px-1 font-mono text-[10px] font-semibold">CORTE · SEM {corte}</span>
                </div>
              )}
            </div>

            {project.dod.map((d) => {
              const ini = d.inicio_semana_plan ?? (d.fin_semana_plan != null ? Math.max(0, d.fin_semana_plan - 1) : null);
              const fin = d.fin_semana_plan;
              const e = estilo(d);
              return (
                <div key={d.codigo} className="grid grid-cols-[230px_minmax(0,1fr)] border-b border-line">
                  <button onClick={onSelect} className="min-w-0 px-5 py-2.5 text-left hover:bg-accent-soft/50" title="Ver aprobación">
                    <span className="mr-2 font-mono text-[12px] font-semibold text-redline">{d.codigo}</span>
                    <span className="text-[13px] font-medium">{d.entregable}</span>
                    <span className="mt-1 flex items-center gap-2">
                      <EstadoSello estado={d.estado} />
                      {e.tag && <Sello tone="bad">{e.tag}</Sello>}
                    </span>
                  </button>
                  <div className="relative mr-6 min-h-[58px]">
                    {fin != null ? (
                      <div
                        className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden border-[1.5px] px-1.5 font-mono text-[10.5px] font-semibold ${e.cls}`}
                        style={{ left: pos(ini), width: `max(${pos(fin - ini)}, 6px)`, background: e.bg }}
                        title={`${d.codigo}: semana ${ini} a ${fin}`}
                      >
                        <span className="truncate">S{ini}–S{fin}</span>
                      </div>
                    ) : (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted">Sin fechas en la línea base (L-04)</span>
                    )}
                    {d.estado === 'Aprobado' && d.aprobacion && (
                      <span
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-surface bg-ok"
                        style={{ left: pos(d.aprobacion.semana_aprobacion), marginTop: 15 }}
                        title={`Aprobado por ${d.aprobacion.rol_aprobador} en la semana ${d.aprobacion.semana_aprobacion}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 px-5 py-3 font-mono text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 border-[1.5px] border-fg bg-surface" />Pendiente</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 border-[1.5px] border-fg bg-accent-soft" />En revisión</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 border-[1.5px] border-ok bg-ok-soft" />Aprobado</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 border-[1.5px] border-bad" style={{ background: 'repeating-linear-gradient(135deg, var(--bad-soft) 0 3px, var(--surface) 3px 6px)' }} />Atrasado al corte</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 bg-ok" />Semana de aprobación</span>
        <span>Las semanas de inicio y fin se editan en la línea base (L-04).</span>
      </div>
    </div>
  );
}

function Aprobaciones({ project, setProject, toast }) {
  const [sel, setSel] = useState(project.dod.find((d) => d.estado === 'En revisión')?.codigo ?? project.dod[0]?.codigo);
  const d = project.dod.find((x) => x.codigo === sel) ?? project.dod[0];
  const corte = project.evm.semana_corte;
  const [ev, setEv] = useState({ url: '', descripcion: '' });
  const [semana, setSemana] = useState(corte);
  const [comentario, setComentario] = useState('');
  const [rechazo, setRechazo] = useState(null); // null | string (motivo en edición)

  useEffect(() => { setSemana(corte); setComentario(''); setRechazo(null); setEv({ url: '', descripcion: '' }); }, [sel, corte]);
  if (!d) return null;

  const rolA = rolAccountable(project, d.codigo);
  const sinEvidencia = d.evidencia_registrada.length === 0;
  const act = (fn, msg) => { setProject(fn); toast('ok', msg); };

  const agregarEvidencia = (e) => {
    e.preventDefault();
    if (!ev.url.trim()) return;
    setProject((p) => addEvidence(p, d.codigo, { url: ev.url.trim(), descripcion: ev.descripcion.trim(), semana: corte }));
    setEv({ url: '', descripcion: '' });
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <ol className="border-b border-line lg:border-b-0 lg:border-r">
        {project.dod.map((x) => (
          <li key={x.codigo}>
            <button
              onClick={() => setSel(x.codigo)}
              className={`flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left ${x.codigo === d.codigo ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--redline)]' : 'hover:bg-accent-soft/50'}`}
            >
              <span className="w-8 font-mono text-[12.5px] font-semibold text-redline">{x.codigo}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{x.entregable}</span>
                <span className="font-mono text-[10.5px] text-muted">{x.evidencia_registrada.length} evidencia(s)</span>
              </span>
              <EstadoSello estado={x.estado} />
            </button>
          </li>
        ))}
      </ol>

      <div className="flex min-w-0 flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[12px] font-semibold text-redline">{d.codigo}</div>
            <h3 className="text-[22px] font-bold leading-tight">{d.entregable}</h3>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted">
              <span>R · {d.responsable}</span>
              <span className={rolA ? '' : 'text-bad'}>A · {rolA ?? 'sin aprobador único en la RACI'}</span>
            </div>
          </div>
          <EstadoSello estado={d.estado} />
        </div>

        <div className="border border-line bg-paper p-3.5">
          <div className="eyebrow mb-1">Criterio de aceptación</div>
          <p className="text-[13px] leading-relaxed">{d.criterio_aceptacion || '—'}</p>
          <div className="eyebrow mb-1 mt-3">Evidencia esperada</div>
          <p className="text-[13px] leading-relaxed text-muted">{d.evidencia || '—'}</p>
        </div>

        <div>
          <div className="eyebrow mb-2">Evidencia registrada</div>
          {d.evidencia_registrada.length > 0 ? (
            <ul className="mb-3 flex flex-col border-t border-line">
              {d.evidencia_registrada.map((e, j) => (
                <li key={j} className="flex items-start gap-2 border-b border-line py-2">
                  <Link2 size={14} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-all font-mono text-[12.5px]">{e.url}</span>
                    {e.descripcion && <span className="text-[12px] text-muted">{e.descripcion}</span>}
                  </span>
                  {e.semana != null && <span className="font-mono text-[11px] text-muted">sem {e.semana}</span>}
                  {d.estado !== 'Aprobado' && <IconButton icon={Trash2} label="Quitar evidencia" onClick={() => setProject((p) => removeEvidence(p, d.codigo, j))} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-[13px] text-muted">Aún no hay evidencia. Registra rutas del repositorio o enlaces verificables (commit, PR, informe) con versión y fecha.</p>
          )}
          {d.estado !== 'Aprobado' && (
            <form onSubmit={agregarEvidencia} className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
              <input id="ev-url" aria-label="Enlace o ruta de la evidencia" placeholder="docs/informe.md@a1b2c3 o https://…" className="field font-mono text-[12.5px]" value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} />
              <input id="ev-desc" aria-label="Descripción de la evidencia" placeholder="Descripción (opcional)" className="field" value={ev.descripcion} onChange={(e) => setEv({ ...ev, descripcion: e.target.value })} />
              <SmallButton icon={Plus} type="submit" disabled={!ev.url.trim()}>Registrar</SmallButton>
            </form>
          )}
        </div>

        <div className="border-t-2 border-fg pt-4">
          {(d.estado === 'Pendiente' || d.estado === 'Rechazado') && (
            <div className="flex flex-col gap-3">
              {d.estado === 'Rechazado' && d.comentario_revision && (
                <div className="border-[1.5px] border-bad bg-bad-soft px-3 py-2 text-[13px] text-bad">Motivo del rechazo: {d.comentario_revision}</div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <SmallButton icon={Send} tone="primary" disabled={sinEvidencia} onClick={() => act((p) => sendToReview(p, d.codigo), `${d.codigo} enviado a revisión`)}>
                  Enviar a revisión
                </SmallButton>
                {sinEvidencia && <span className="font-mono text-[11.5px] text-muted">Registra al menos una evidencia para enviarlo.</span>}
              </div>
            </div>
          )}

          {d.estado === 'En revisión' && (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <div>
                  <Label htmlFor="apr-sem">Semana</Label>
                  <input id="apr-sem" type="number" min="0" max={corte} className="field font-mono tnum" value={semana} onChange={(e) => setSemana(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
                </div>
                <div>
                  <Label htmlFor="apr-com">Comentario de aprobación</Label>
                  <input id="apr-com" className="field" placeholder="Verificado contra el criterio de aceptación…" value={comentario} onChange={(e) => setComentario(e.target.value)} />
                </div>
              </div>
              {semana > corte && <p className="font-mono text-[11.5px] text-bad">La semana de aprobación no puede ser posterior al corte (semana {corte}).</p>}
              {rechazo == null ? (
                <div className="flex flex-wrap gap-2">
                  <SmallButton icon={Stamp} tone="primary" disabled={!rolA || semana > corte}
                    onClick={() => act((p) => approveDod(p, d.codigo, { semana, comentario }), `${d.codigo} aprobado por ${rolA}`)}>
                    Aprobar como {rolA ?? '—'}
                  </SmallButton>
                  <SmallButton icon={CircleX} tone="danger" onClick={() => setRechazo('')}>Rechazar</SmallButton>
                </div>
              ) : (
                <div className="flex flex-col gap-2 border-[1.5px] border-bad p-3">
                  <Label htmlFor="apr-motivo">Motivo del rechazo</Label>
                  <input id="apr-motivo" className="field" autoFocus value={rechazo} onChange={(e) => setRechazo(e.target.value)} placeholder="Qué criterio no se cumple y qué falta…" />
                  <div className="flex flex-wrap justify-end gap-2">
                    <SmallButton onClick={() => setRechazo(null)}>Cancelar</SmallButton>
                    <SmallButton tone="danger" disabled={!rechazo.trim()} onClick={() => act((p) => rejectDod(p, d.codigo, rechazo.trim()), `${d.codigo} rechazado`)}>Confirmar rechazo</SmallButton>
                  </div>
                </div>
              )}
              {!rolA && <p className="font-mono text-[11.5px] text-bad">Define un único A para {d.codigo} en la matriz RACI; solo ese rol puede aprobar.</p>}
            </div>
          )}

          {d.estado === 'Aprobado' && d.aprobacion && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="-rotate-3 border-[2.5px] border-ok px-3 py-1.5 text-ok">
                  <div className="font-mono text-[15px] font-bold tracking-[0.12em]">APROBADO</div>
                  <div className="font-mono text-[10.5px]">{d.aprobacion.rol_aprobador} · SEM {d.aprobacion.semana_aprobacion}</div>
                </div>
                <div className="min-w-0 text-[13px]">
                  {d.aprobacion.comentario && <p>“{d.aprobacion.comentario}”</p>}
                  <p className="font-mono text-[11.5px] text-muted">
                    {aprobadoAlCorte(d, corte) ? `Suma ${formatMoney(d.presupuesto, project.evm.unidad)} al EV` : 'Fuera del corte actual: no suma al EV'}
                  </p>
                </div>
              </div>
              <SmallButton icon={Undo2} onClick={() => act((p) => reopenDod(p, d.codigo), `${d.codigo} reabierto`)}>Reabrir</SmallButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RaciGrid({ project, setProject, roles }) {
  const carga = roles.map((rol) => project.dod.reduce((n, d) => n + (project.raci[d.codigo]?.[rol] === 'R' ? 1 : 0), 0));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-3 font-mono text-[12px] text-muted">
        {Object.entries(RACI_MEANING).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`${CIRCLE} !h-[22px] !w-[22px] !text-[11px] ${RACI_STYLE[k]}`}>{k}</span>{v}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]" style={{ minWidth: 440 + roles.length * 92 }}>
          <thead>
            <tr>
              <th className={`${TH} w-14 border-r border-r-line pl-5`}>ID</th>
              <th className={`${TH} border-r border-r-line`}>Entregable</th>
              {roles.map((r, j) => (
                <th key={r} className={`${TH} w-[92px] border-r border-r-line text-center align-bottom normal-case tracking-normal`} title={r}>
                  <div className="text-redline">{String.fromCharCode(67 + j)}</div>
                  <div className="line-clamp-2 font-display text-[13px] font-semibold leading-tight text-fg">{r}</div>
                </th>
              ))}
              <th className={`${TH} w-40 pr-5`}>Control</th>
            </tr>
          </thead>
          <tbody>
            {project.dod.map((d, i) => {
              const fila = project.raci[d.codigo] ?? {};
              return (
                <tr key={d.codigo + i}>
                  <td className="border-b border-r border-line px-2 py-2 pl-5 font-mono text-muted tnum">{i + 1}</td>
                  <td className="border-b border-r border-line px-2 py-2">
                    <span className="mr-2 font-mono text-[12.5px] font-semibold text-redline">{d.codigo}</span>
                    <span className="font-medium">{d.entregable}</span>
                    <div className="font-mono text-[11px] text-muted">Responsable DoD: {d.responsable}</div>
                  </td>
                  {roles.map((rol) => {
                    const v = fila[rol] ?? '';
                    return (
                      <td key={rol} className="border-b border-r border-line px-1 py-1.5 text-center">
                        <button
                          onClick={() => setProject((p) => cycleRaci(p, d.codigo, rol))}
                          aria-label={`${d.codigo}, ${rol}: ${v || 'vacío'}. Clic para cambiar`}
                          className={`${CIRCLE} mx-auto transition-transform active:scale-90 ${RACI_STYLE[v]}`}
                        >
                          {v || '·'}
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-line px-2 py-2 pr-5"><RaciSello fila={fila} roles={roles} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-mono text-[11px] text-muted">
              <td className="px-2 py-2.5 pl-5" />
              <td className="px-2 py-2.5 text-right uppercase tracking-[0.06em]">Carga de R</td>
              {carga.map((n, j) => (
                <td key={j} className={`px-1 py-2.5 text-center text-[13px] tnum ${n / Math.max(project.dod.length, 1) > 0.5 ? 'font-semibold text-warn' : 'text-fg'}`}>{n}</td>
              ))}
              <td className="pr-5" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 py-3 font-mono text-[11.5px] text-muted">
        NOTA 1 · Clic en un círculo para alternar — → R → A → C → I. Cada fila requiere exactamente un A y al menos un R; el responsable del DoD debe ser R.
      </p>
    </>
  );
}

// ===========================================================================
// L-03 · Riesgos 5×5
// ===========================================================================
const HEAT = { Bajo: 'bg-heat-low', Medio: 'bg-heat-mid', Alto: 'bg-heat-high' };
const IMPACT_TONE = { Bajo: 'ok', Medio: 'warn', Alto: 'bad' };

const newRisk = (p) => ({
  codigo: nextCode('R', p.riesgos), tipo: 'Amenaza', descripcion: '', gravedad: 3, probabilidad: 3,
  tipo_estrategia: 'Mitigar', estrategia: '', propietario: p.equipo[0]?.rol ?? '', fecha_revision: null,
  entregables_afectados: [], disparador: '', justificacion_aceptacion: null, estado: 'Identificado',
});

function RiesgosTab({ project, setProject, toast }) {
  const [sel, setSel] = useState(project.riesgos[0]?.codigo ?? null);
  const [draft, setDraft] = useState(() => project.riesgos[0] ?? newRisk(project));
  const roles = project.equipo.map((m) => m.rol);
  const editing = project.riesgos.findIndex((r) => r.codigo === sel);

  const select = (r) => { setSel(r.codigo); setDraft(structuredClone(r)); };
  const startNew = () => { setSel(null); setDraft(newRisk(project)); };
  const d = (patch) => setDraft((x) => ({ ...x, ...patch }));

  const save = () => {
    if (!draft.codigo.trim() || !draft.descripcion.trim() || !draft.estrategia.trim()) {
      toast('bad', 'Completa código, descripción del riesgo y descripción de la respuesta.');
      return;
    }
    if (project.riesgos.some((r, i) => r.codigo === draft.codigo && i !== editing)) {
      toast('bad', `Ya existe un riesgo con código ${draft.codigo}.`);
      return;
    }
    const limpio = { ...draft, fecha_revision: draft.fecha_revision || null };
    setProject((p) => ({ ...p, riesgos: editing >= 0 ? p.riesgos.map((r, i) => (i === editing ? limpio : r)) : [...p.riesgos, limpio] }));
    setSel(limpio.codigo);
    toast('ok', editing >= 0 ? `${limpio.codigo} actualizado` : `${limpio.codigo} agregado`);
  };

  const remove = () => {
    setProject((p) => ({ ...p, riesgos: p.riesgos.filter((r) => r.codigo !== sel) }));
    startNew();
  };

  const score = draft.gravedad * draft.probabilidad;
  const nivel = riskLevel(score);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      <Detalle letra="A" eyebrow="Gravedad × Probabilidad" title="Mapa de calor 5×5">
        <Heatmap riesgos={project.riesgos} selected={sel} onSelect={select} />
      </Detalle>

      <div className="flex min-w-0 flex-col gap-6">
        <Detalle
          letra="B"
          eyebrow="Registro de riesgos"
          title={editing >= 0 ? `Editar ${sel}` : 'Nuevo riesgo'}
          actions={<SmallButton icon={Plus} onClick={startNew}>Nuevo</SmallButton>}
        >
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-1">
              <Label htmlFor="rk-cod">Código</Label>
              <input id="rk-cod" className="field font-mono font-semibold text-redline" value={draft.codigo} onChange={(e) => d({ codigo: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rk-tipo">Tipo</Label>
              <div id="rk-tipo" className="flex border border-fg">
                {Object.keys(ESTRATEGIAS).map((t) => (
                  <button key={t} type="button" onClick={() => d({ tipo: t, tipo_estrategia: ESTRATEGIAS[t].includes(draft.tipo_estrategia) ? draft.tipo_estrategia : ESTRATEGIAS[t][0] })}
                    className={`min-h-[34px] flex-1 px-2 font-display text-[14px] font-semibold ${draft.tipo === t ? 'bg-accent text-accent-fg' : 'text-fg hover:bg-accent-soft'}`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="rk-prop">Responsable</Label>
              <RoleSelect id="rk-prop" className="field" value={draft.propietario} roles={roles} onChange={(v) => d({ propietario: v })} />
            </div>
            <div className="sm:col-span-6">
              <Label htmlFor="rk-desc">Riesgo</Label>
              <textarea id="rk-desc" rows={2} className="field" placeholder="Si ocurre…, entonces…" value={draft.descripcion} onChange={(e) => d({ descripcion: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rk-grav">Gravedad</Label>
              <select id="rk-grav" className="field" value={draft.gravedad} onChange={(e) => d({ gravedad: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v} ({GRAVEDAD[v]})</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rk-prob">Probabilidad</Label>
              <select id="rk-prob" className="field" value={draft.probabilidad} onChange={(e) => d({ probabilidad: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v} ({PROBABILIDAD[v]})</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Impacto</div>
              <div className="flex h-[36px] items-center gap-2.5">
                <span className="font-mono text-[20px] font-semibold tnum">{draft.gravedad}×{draft.probabilidad} = {score}</span>
                <Sello tone={IMPACT_TONE[nivel]}>{nivel}</Sello>
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rk-est" hint={draft.tipo}>Estrategia</Label>
              <select id="rk-est" className="field" value={draft.tipo_estrategia} onChange={(e) => d({ tipo_estrategia: e.target.value })}>
                {ESTRATEGIAS[draft.tipo].map((e) => <option key={e}>{e}</option>)}
              </select>
            </div>
            <div className="sm:col-span-4">
              <Label htmlFor="rk-resp">Descripción de la respuesta</Label>
              <textarea id="rk-resp" rows={2} className="field" value={draft.estrategia} onChange={(e) => d({ estrategia: e.target.value })} />
              <div className="mt-1 truncate font-mono text-[11px] text-muted">En Excel: “{draft.tipo_estrategia}: {draft.estrategia || '…'}”</div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rk-fecha">Fecha de revisión</Label>
              <input id="rk-fecha" type="date" className="field font-mono" value={draft.fecha_revision ?? ''} onChange={(e) => d({ fecha_revision: e.target.value || null })} />
            </div>
            <div className="sm:col-span-4">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Entregables afectados</div>
              <div className="flex flex-wrap gap-1.5">
                {project.dod.map((x) => {
                  const on = draft.entregables_afectados?.includes(x.codigo);
                  return (
                    <button key={x.codigo} type="button" title={x.entregable}
                      onClick={() => d({ entregables_afectados: on ? draft.entregables_afectados.filter((c) => c !== x.codigo) : [...(draft.entregables_afectados ?? []), x.codigo] })}
                      className={`min-h-[30px] border px-2.5 font-mono text-[12px] font-semibold ${on ? 'border-fg bg-fg text-paper' : 'border-line text-muted hover:border-fg'}`}>
                      {x.codigo}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {editing >= 0 && <SmallButton icon={Trash2} tone="danger" onClick={remove}>Eliminar</SmallButton>}
            <SmallButton tone="primary" onClick={save}>{editing >= 0 ? 'Guardar cambios' : 'Agregar riesgo'}</SmallButton>
          </div>
        </Detalle>

        <Detalle letra="C" eyebrow={`${project.riesgos.length} riesgos`} title="Registro" flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={`${TH} pl-5`}>Código</th>
                  <th className={TH}>Riesgo</th>
                  <th className={TH}>Tipo</th>
                  <th className={`${TH} text-center`}>G × P</th>
                  <th className={TH}>Impacto</th>
                  <th className={`${TH} pr-5`}>Estrategia</th>
                </tr>
              </thead>
              <tbody>
                {project.riesgos.map((r) => {
                  const s = riskScore(r);
                  return (
                    <tr key={r.codigo} onClick={() => select(r)} className={`cursor-pointer hover:bg-accent-soft/50 ${sel === r.codigo ? 'bg-accent-soft/70' : ''}`}>
                      <td className={`${TD} py-2.5 pl-5 font-mono font-semibold text-redline`}>{r.codigo}</td>
                      <td className={`${TD} max-w-[320px] py-2.5`}><div className="line-clamp-2">{r.descripcion}</div><div className="font-mono text-[11px] text-muted">{r.propietario}</div></td>
                      <td className={`${TD} py-2.5`}>{r.tipo}</td>
                      <td className={`${TD} py-2.5 text-center font-mono tnum`}>{r.gravedad}×{r.probabilidad} = {s}</td>
                      <td className={`${TD} py-2.5`}><Sello tone={IMPACT_TONE[riskLevel(s)]}>{riskLevel(s)}</Sello></td>
                      <td className={`${TD} py-2.5 pr-5 font-display text-[14px] font-semibold`}>{r.tipo_estrategia}</td>
                    </tr>
                  );
                })}
                {!project.riesgos.length && <tr><td colSpan={6} className="px-5 py-8 text-center text-muted">Sin riesgos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </Detalle>
      </div>
    </div>
  );
}

function Heatmap({ riesgos, selected, onSelect }) {
  const byCell = {};
  riesgos.forEach((r) => { (byCell[`${r.gravedad}-${r.probabilidad}`] ??= []).push(r); });
  return (
    <div>
      <div className="flex gap-2">
        <div className="flex w-5 items-center justify-center">
          <span className="eyebrow -rotate-90 whitespace-nowrap">Probabilidad →</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-[26px_repeat(5,minmax(0,1fr))] border-b border-l border-fg">
            {[5, 4, 3, 2, 1].map((p) => (
              <HeatRow key={p} p={p} byCell={byCell} selected={selected} onSelect={onSelect} />
            ))}
          </div>
          <div className="grid grid-cols-[26px_repeat(5,minmax(0,1fr))]">
            <div />
            {[1, 2, 3, 4, 5].map((g) => (
              <div key={g} className="pt-1 text-center font-mono text-[11px] text-muted" title={GRAVEDAD[g]}>{g}</div>
            ))}
          </div>
          <div className="eyebrow mt-1 text-center">Gravedad →</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 font-mono text-[11.5px] text-muted">
        {[['Bajo', '1–6'], ['Medio', '7–12'], ['Alto', '13–25']].map(([n, r]) => (
          <span key={n} className="flex items-center gap-1.5"><span className={`h-3 w-3 border border-fg ${HEAT[n]}`} />{n} {r}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 border border-dashed border-fg" />Oportunidad</span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-y-1 border-t border-line pt-3 font-mono text-[11px] text-muted sm:grid-cols-2 sm:gap-x-4">
        {[1, 2, 3, 4, 5].map((v) => (
          <div key={v} className="flex gap-1.5"><dt className="text-fg">{v}</dt><dd>{GRAVEDAD[v]} · {PROBABILIDAD[v]}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function HeatRow({ p, byCell, selected, onSelect }) {
  return (
    <>
      <div className="flex items-center justify-center border-r border-fg font-mono text-[11px] text-muted" title={PROBABILIDAD[p]}>{p}</div>
      {[1, 2, 3, 4, 5].map((g) => {
        const s = g * p;
        const items = byCell[`${g}-${p}`] ?? [];
        return (
          <div key={g} className={`relative flex aspect-square min-w-0 flex-wrap content-center items-center justify-center gap-1 border-r border-t border-line p-1 ${HEAT[riskLevel(s)]}`}>
            <span className="absolute left-1 top-0.5 font-mono text-[9.5px] text-muted tnum">{s}</span>
            {items.map((r) => (
              <button key={r.codigo} onClick={() => onSelect(r)} title={r.descripcion}
                className={`min-h-[24px] px-1.5 font-mono text-[11.5px] font-semibold ${r.tipo === 'Oportunidad' ? 'border border-dashed' : 'border'} ${selected === r.codigo ? 'border-fg bg-fg text-paper' : 'border-fg bg-surface text-fg'}`}>
                {r.codigo}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

// ===========================================================================
// L-04 · KPIs + EVM
// ===========================================================================
function KpiEvmTab({ project, setProject, toast }) {
  const evm = resolveEVM(project);
  const r = calcEVM(evm);
  const lineaBase = project.evm.modo === 'linea_base';
  const roles = project.equipo.map((m) => m.rol);
  const setEvm = (patch) => setProject((p) => ({ ...p, evm: { ...p.evm, ...patch } }));
  const setKpi = (i, patch) => setProject((p) => ({ ...p, kpis: p.kpis.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));
  const money = (v) => formatMoney(v, evm.unidad);
  const adel = project.kpis.filter((k) => k.tipo_indicador === 'Adelantado').length;
  const rez = project.kpis.length - adel;

  const addKpi = () => setProject((p) => ({
    ...p,
    kpis: [...p.kpis, { codigo: nextCode('K', p.kpis), nombre: 'Nuevo KPI', tipo_indicador: 'Adelantado', definicion: '', formula: '', unidad: '', meta: '', fuente: '', responsable: roles[0] ?? '', frecuencia: 'Semanal', valor_actual: null }],
  }));

  const pct = (v) => `${fmtNum(Math.abs(v) * 100, 0)} %`;
  const spiText = r.spi == null
    ? 'Sin datos: ingresa un Valor Planificado (PV) mayor que 0.'
    : r.spi >= 1
      ? `Sobre la cota 1,00. Se completó ${fmtNum(r.spi)} por cada 1 planificado: el cronograma va ${r.spi > 1 ? `${pct(r.spi - 1)} adelantado` : 'en plazo'} (SV = ${money(r.sv)}).`
      : `Bajo la cota 1,00. Se completó ${fmtNum(r.spi)} por cada 1 planificado: el cronograma va ${pct(1 - r.spi)} atrasado (SV = ${money(r.sv)}).`;
  const cpiText = r.cpi == null
    ? 'Sin datos: ingresa un Costo Real (AC) mayor que 0.'
    : r.cpi >= 1
      ? `Sobre la cota 1,00. Cada 1 gastado produce ${fmtNum(r.cpi)} de valor: ${r.cpi > 1 ? `${pct(r.cpi - 1)} bajo presupuesto` : 'en presupuesto'} (CV = ${money(r.cv)}).`
      : `Bajo la cota 1,00. Cada 1 gastado produce ${fmtNum(r.cpi)} de valor: sobrecosto de ${pct(1 - r.cpi)} (CV = ${money(r.cv)}).`;

  const maxBar = Math.max(evm.bac, evm.pv, evm.ac, r.ev, 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Detalle
          letra="A"
          eyebrow={`Fecha de corte · BAC ${money(evm.bac)}`}
          title="Datos de medición"
          actions={
            <div className="flex border border-fg" role="tablist" aria-label="Modo de cálculo">
              {[['linea_base', 'Línea base'], ['manual', 'Manual']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={project.evm.modo === id} onClick={() => setEvm({ modo: id })}
                  className={`min-h-[34px] px-3 font-display text-[14px] font-semibold ${project.evm.modo === id ? 'bg-accent text-accent-fg' : 'text-fg hover:bg-accent-soft'}`}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex flex-col gap-5">
            {lineaBase ? (
              <CorteLineaBase project={project} evm={evm} r={r} setEvm={setEvm} money={money} />
            ) : (
            <>
            <div>
              <Label htmlFor="evm-avance" hint={<span className="font-mono text-fg tnum">{fmtNum(evm.porcentaje_avance, 1)} %</span>}>% Avance real</Label>
              <input id="evm-avance" type="range" min="0" max="100" step="0.5" className="w-full" value={evm.porcentaje_avance} onChange={(e) => setEvm({ porcentaje_avance: Number(e.target.value) })} />
              <input id="evm-avance-num" aria-label="% avance real" type="number" min="0" max="100" step="0.1" className="field mt-1.5 font-mono tnum" value={Number(evm.porcentaje_avance.toFixed(2))} onChange={(e) => setEvm({ porcentaje_avance: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="evm-pv" hint={money(evm.pv)}>Valor planificado (PV)</Label>
                <input id="evm-pv" type="range" min="0" max={Math.max(evm.bac, 1)} step="any" className="w-full" value={evm.pv} onChange={(e) => setEvm({ pv: Number(e.target.value) })} />
                <input id="evm-pv-num" aria-label="PV" type="number" min="0" step="any" className="field mt-1.5 font-mono tnum" value={evm.pv} onChange={(e) => setEvm({ pv: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div>
                <Label htmlFor="evm-ac" hint={money(evm.ac)}>Costo real (AC)</Label>
                <input id="evm-ac" type="range" min="0" max={Math.max(evm.bac * 1.5, evm.ac, 1)} step="any" className="w-full" value={evm.ac} onChange={(e) => setEvm({ ac: Number(e.target.value) })} />
                <input id="evm-ac-num" aria-label="AC" type="number" min="0" step="any" className="field mt-1.5 font-mono tnum" value={evm.ac} onChange={(e) => setEvm({ ac: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
            </div>
            </>
            )}
            <div className="flex flex-col gap-2 border-t border-line pt-4" aria-label="Comparación BAC, PV, EV y AC a escala">
              {[['BAC', evm.bac, 'bg-line'], ['PV', evm.pv, 'bg-muted'], ['EV', r.ev, 'bg-fg'], ['AC', evm.ac, 'bg-redline']].map(([k, v, c]) => (
                <div key={k} className="grid grid-cols-[34px_minmax(0,1fr)_minmax(96px,auto)] items-center gap-3 font-mono text-[12px]">
                  <span className="font-semibold text-muted">{k}</span>
                  <div className="h-2 border border-line bg-paper"><div className={`h-full ${c}`} style={{ width: `${(v / maxBar) * 100}%` }} /></div>
                  <span className="text-right tnum">{money(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </Detalle>

        <Detalle letra="B" eyebrow="Valor ganado" title="Cotas de desempeño">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
              <span className="font-mono text-[12px] text-muted">EV = {fmtNum(evm.porcentaje_avance, 1)} % × BAC</span>
              <span className="font-mono text-[30px] font-semibold leading-none tnum">{money(r.ev)}</span>
            </div>
            <Cota nombre="SPI" formula="EV / PV" valor={r.spi} texto={spiText} />
            <Cota nombre="CPI" formula="EV / AC" valor={r.cpi} texto={cpiText} />
            <div className="grid grid-cols-2 border border-fg sm:grid-cols-3">
              {[['EAC', r.eac], ['ETC', r.etc], ['VAC', r.vac]].map(([k, v], i) => (
                <div key={k} className={`px-3 py-2 ${i < 2 ? 'border-r border-fg' : 'col-span-2 border-t border-fg sm:col-span-1 sm:border-t-0'}`}>
                  <div className="font-mono text-[10.5px] tracking-[0.08em] text-muted">{k}</div>
                  <div className="font-mono text-[14px] tnum">{money(v)}</div>
                </div>
              ))}
            </div>
          </div>
        </Detalle>
      </div>

      {lineaBase && (
        <>
          <CurvaS project={project} money={money} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <LineaBaseTabla project={project} setProject={setProject} money={money} />
            <RegistroCostos project={project} setProject={setProject} money={money} toast={toast} />
          </div>
        </>
      )}

      <Detalle
        letra={lineaBase ? 'F' : 'C'}
        eyebrow={`${project.kpis.length} indicadores`}
        title="Matriz de KPIs"
        actions={<SmallButton icon={Plus} tone="primary" onClick={addKpi}>Agregar KPI</SmallButton>}
        flush
      >
        <div className="flex flex-col gap-2 border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[12px]">
            <span className="uppercase tracking-[0.06em] text-muted">Balance de indicadores</span>
            <span className="tnum">{adel} adelantados · {rez} rezagados</span>
          </div>
          <div className="flex h-2.5 border border-fg bg-paper">
            <div className="bg-fg" style={{ width: `${project.kpis.length ? (adel / project.kpis.length) * 100 : 0}%` }} />
            <div className="bg-line" style={{ width: `${project.kpis.length ? (rez / project.kpis.length) * 100 : 0}%` }} />
          </div>
          {project.kpis.length > 0 && adel === 0 && (
            <div className="flex items-start gap-2 border border-warn bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
              <TriangleAlert size={15} className="mt-px shrink-0" />
              Todos los KPIs miran hacia atrás. Agrega al menos un indicador adelantado (por ejemplo, historias del próximo sprint listas para desarrollo) para anticipar desvíos.
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`${TH} w-20 pl-5`}>Código</th>
                <th className={`${TH} w-44`}>KPI</th>
                <th className={TH}>Descripción</th>
                <th className={`${TH} w-32`}>Indicador</th>
                <th className={`${TH} w-56`}>Método de medición</th>
                <th className={`${TH} w-44`}>Meta / valor esperado</th>
                <th className={`${TH} w-32`}>Actual</th>
                <th className={`${TH} w-40`}>Responsable</th>
                <th className={`${TH} w-32`}>Frecuencia</th>
                <th className={`${TH} w-10 pr-5`} />
              </tr>
            </thead>
            <tbody>
              {project.kpis.map((k, i) => (
                <tr key={i}>
                  <td className={`${TD} pl-5`}><input id={`kpi-cod-${i}`} aria-label="Código" className="cell font-mono font-semibold text-redline" value={k.codigo} onChange={(e) => setKpi(i, { codigo: e.target.value })} /></td>
                  <td className={TD}><textarea id={`kpi-nom-${i}`} aria-label="KPI" rows={2} className="cell font-medium" value={k.nombre} onChange={(e) => setKpi(i, { nombre: e.target.value })} /></td>
                  <td className={TD}><textarea id={`kpi-def-${i}`} aria-label="Descripción" rows={3} className="cell" value={k.definicion} onChange={(e) => setKpi(i, { definicion: e.target.value })} /></td>
                  <td className={`${TD} py-2.5`}>
                    <button onClick={() => setKpi(i, { tipo_indicador: k.tipo_indicador === 'Adelantado' ? 'Rezagado' : 'Adelantado' })} title="Clic para cambiar">
                      <Sello tone={k.tipo_indicador === 'Adelantado' ? 'accent' : 'muted'}>{k.tipo_indicador}</Sello>
                    </button>
                  </td>
                  <td className={TD}><textarea id={`kpi-met-${i}`} aria-label="Método de medición" rows={3} className="cell font-mono text-[12px]" value={kpiMetodo(k)} onChange={(e) => setKpi(i, { metodo_medicion: e.target.value })} /></td>
                  <td className={TD}><textarea id={`kpi-meta-${i}`} aria-label="Meta" rows={2} className="cell" value={formatMeta(k)} onChange={(e) => setKpi(i, { meta: e.target.value })} /></td>
                  <td className={`${TD} py-2.5`}><KpiActual project={project} kpi={k} /></td>
                  <td className={TD}><RoleSelect id={`kpi-resp-${i}`} value={k.responsable} roles={roles} onChange={(v) => setKpi(i, { responsable: v })} /></td>
                  <td className={TD}><input id={`kpi-frec-${i}`} aria-label="Frecuencia" className="cell" value={k.frecuencia} onChange={(e) => setKpi(i, { frecuencia: e.target.value })} /></td>
                  <td className={`${TD} pr-5`}><IconButton icon={Trash2} label={`Eliminar ${k.codigo}`} onClick={() => setProject((p) => ({ ...p, kpis: p.kpis.filter((_, j) => j !== i) }))} /></td>
                </tr>
              ))}
              {!project.kpis.length && <tr><td colSpan={10} className="px-5 py-8 text-center text-muted">Sin KPIs definidos.</td></tr>}
            </tbody>
          </table>
        </div>
      </Detalle>

      {project.kpis.length > 0 && (
        <MedicionesKPI project={project} setProject={setProject} toast={toast} letra={lineaBase ? 'G' : 'D'} />
      )}
    </div>
  );
}

const KPI_ESTADO = {
  cumple: ['ok', 'Cumple'],
  en_riesgo: ['warn', 'En riesgo'],
  no_cumple: ['bad', 'No cumple'],
  sin_meta: ['muted', 'Sin meta numérica'],
  sin_datos: ['muted', 'Sin datos'],
};
const KpiSello = ({ estado }) => <Sello tone={KPI_ESTADO[estado][0]}>{KPI_ESTADO[estado][1]}</Sello>;
const fmtValor = (v) => (v == null ? '—' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(v));

function KpiActual({ project, kpi }) {
  const ev = evaluarKPI(project, kpi);
  return (
    <div className="flex flex-col items-start gap-1">
      <KpiSello estado={ev.estado} />
      {ev.ultima && <span className="font-mono text-[11.5px] tnum">{fmtValor(ev.ultima.valor)} · sem {ev.ultima.semana}</span>}
    </div>
  );
}

function MedicionesKPI({ project, setProject, toast, letra }) {
  const corte = project.evm.semana_corte;
  const [sel, setSel] = useState(project.kpis[0].codigo);
  const k = project.kpis.find((x) => x.codigo === sel) ?? project.kpis[0];
  const [form, setForm] = useState({ semana: corte, valor: '', nota: '' });
  useEffect(() => { setForm({ semana: corte, valor: '', nota: '' }); }, [sel, corte]);

  const auto = medicionAutomatica(project, k);
  const registrar = (med, msg) => {
    setProject((p) => addMedicion(p, k.codigo, med));
    toast('ok', msg ?? `Medición de ${k.codigo} registrada (semana ${med.semana})`);
  };
  const submit = (e) => {
    e.preventDefault();
    const valor = Number(String(form.valor).replace(',', '.'));
    if (form.valor === '' || !Number.isFinite(valor)) return;
    registrar({ semana: Math.max(0, Math.round(Number(form.semana) || 0)), valor, nota: form.nota.trim() });
    setForm((f) => ({ ...f, valor: '', nota: '' }));
  };
  const historial = [...(k.mediciones ?? [])].sort((a, b) => b.semana - a.semana);

  return (
    <Detalle letra={letra} eyebrow="Seguimiento de indicadores" title="Mediciones de KPIs" flush>
      <div className="grid lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <ol className="border-b border-line lg:border-b-0 lg:border-r">
          {project.kpis.map((x) => (
            <li key={x.codigo}>
              <button onClick={() => setSel(x.codigo)}
                className={`flex w-full items-center gap-3 border-b border-line px-5 py-2.5 text-left ${x.codigo === k.codigo ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--redline)]' : 'hover:bg-accent-soft/50'}`}>
                <span className="w-9 font-mono text-[12px] font-semibold text-redline">{x.codigo}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{x.nombre}</span>
                <KpiSello estado={evaluarKPI(project, x).estado} />
              </button>
            </li>
          ))}
        </ol>

        <div className="flex min-w-0 flex-col gap-4 p-5">
          <div>
            <div className="font-mono text-[12px] font-semibold text-redline">{k.codigo} · {k.tipo_indicador}</div>
            <h3 className="text-[21px] font-bold leading-tight">{k.nombre}</h3>
            <div className="mt-1 font-mono text-[11.5px] text-muted">Meta: {formatMeta(k) || '—'} · {k.frecuencia}</div>
          </div>

          {auto != null && (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-fg bg-paper px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-[13px]">
                <Calculator size={15} className="text-muted" />
                Calculado desde el proyecto al corte (semana {corte}):
                <b className="font-mono tnum">{fmtValor(auto)}</b>
              </span>
              <SmallButton tone="primary" onClick={() => registrar({ semana: corte, valor: Number(auto.toFixed(4)), nota: 'Calculado desde el proyecto' }, `${k.codigo}: medición calculada registrada`)}>
                Registrar
              </SmallButton>
            </div>
          )}

          <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[80px_120px_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label htmlFor="m-sem">Semana</Label>
              <input id="m-sem" type="number" min="0" className="field font-mono tnum" value={form.semana} onChange={(e) => setForm({ ...form, semana: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="m-val">Valor{k.unidad ? ` (${k.unidad})` : ''}</Label>
              <input id="m-val" inputMode="decimal" className="field font-mono tnum" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="m-nota">Nota / fuente</Label>
              <input id="m-nota" className="field" placeholder={k.fuente || 'Origen del dato'} value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} />
            </div>
            <SmallButton icon={Plus} type="submit" disabled={form.valor === ''}>Registrar</SmallButton>
          </form>

          {historial.length === 0 ? (
            <p className="text-[13px] text-muted">Sin mediciones. El indicador se muestra como “Sin datos”: no se infiere cumplimiento ni incumplimiento.</p>
          ) : (
            <div className="overflow-x-auto border border-line">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={`${TH} pl-4`}>Sem.</th>
                    <th className={`${TH} text-right`}>Valor</th>
                    <th className={`${TH} text-right`}>Meta</th>
                    <th className={TH}>Estado</th>
                    <th className={TH}>Nota</th>
                    <th className={`${TH} w-10 pr-4`} />
                  </tr>
                </thead>
                <tbody>
                  {historial.map((m) => {
                    const ev = evaluarMedicion(project, k, m);
                    return (
                      <tr key={m.semana} className={m.semana > corte && project.evm.modo === 'linea_base' ? 'text-muted' : ''}>
                        <td className={`${TD} py-2 pl-4 font-mono tnum`}>{m.semana}</td>
                        <td className={`${TD} py-2 text-right font-mono font-semibold tnum`}>{fmtValor(m.valor)}</td>
                        <td className={`${TD} py-2 text-right font-mono text-muted tnum`}>{ev.meta ? `${ev.meta.op} ${fmtValor(ev.meta.valor)}` : '—'}</td>
                        <td className={`${TD} py-2`}><KpiSello estado={ev.estado} /></td>
                        <td className={`${TD} py-2 text-[12px] text-muted`}>{m.nota}</td>
                        <td className={`${TD} py-1.5 pr-4`}><IconButton icon={Trash2} label={`Eliminar medición semana ${m.semana}`} onClick={() => setProject((p) => removeMedicion(p, k.codigo, m.semana))} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="font-mono text-[11px] text-muted">Semáforo: cumple la meta · en riesgo si está a menos de 10 % de ella · no cumple si está más lejos. Una medición por semana; registrar otra en la misma semana la reemplaza.</p>
        </div>
      </div>
    </Detalle>
  );
}

// ---------------------------------------------------------------------------
// Curva S (PV / EV / AC acumulados por semana)
// ---------------------------------------------------------------------------
const SERIES = [
  { k: 'pv', corto: 'PV', label: 'PV · Valor planificado', color: 'var(--s-pv)', dash: '7 5' },
  { k: 'ev', corto: 'EV', label: 'EV · Valor ganado', color: 'var(--s-ev)' },
  { k: 'ac', corto: 'AC', label: 'AC · Costo real', color: 'var(--s-ac)' },
];

function niceMax(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  const paso = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => v / e <= s);
  return paso * e;
}

function useWidth(ref) {
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => setW(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    window.addEventListener('resize', medir);
    return () => { ro.disconnect(); window.removeEventListener('resize', medir); };
  }, [ref]);
  return w;
}

function CurvaS({ project, money }) {
  const { bac, corte, ultima, puntos } = serieSemanal(project);
  const box = useRef(null);
  const W = Math.max(260, useWidth(box));
  const [hover, setHover] = useState(null);
  const [tabla, setTabla] = useState(false);
  const compacto = W < 520;
  const H = compacto ? 240 : 300;
  const m = { t: 22, r: compacto ? 56 : 92, b: 34, l: compacto ? 48 : 70 };
  const maxY = niceMax(Math.max(bac, ...puntos.map((p) => Math.max(p.pv, p.ev ?? 0, p.ac ?? 0)), 1) * 1.05);
  const pw = W - m.l - m.r;
  const x = (w) => m.l + (w / ultima) * pw;
  const y = (v) => m.t + (1 - v / maxY) * (H - m.t - m.b);
  const corta = (v) => {
    const f = (n, suf) => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(n)}${suf}`;
    return Math.abs(v) >= 1e6 ? f(v / 1e6, ' M') : Math.abs(v) >= 1e3 ? f(v / 1e3, ' k') : f(v, '');
  };
  const pasoX = Math.max(1, Math.ceil(ultima / (compacto ? 6 : 12)));
  const ticksX = puntos.filter((p) => p.semana % pasoX === 0).map((p) => p.semana);
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const linea = (k) => puntos.filter((p) => p[k] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.semana).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');

  // Etiquetas directas al final de cada serie, separadas si chocan
  const fin = SERIES.map((s) => {
    const p = [...puntos].reverse().find((q) => q[s.k] != null);
    return { ...s, semana: p.semana, v: p[s.k], ly: y(p[s.k]) };
  }).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < fin.length; i++) if (fin[i].ly - fin[i - 1].ly < 15) fin[i].ly = fin[i - 1].ly + 15;

  const h = hover != null ? puntos[hover] : null;
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = Math.round(((e.clientX - r.left) / r.width) * ultima);
    setHover(Math.min(ultima, Math.max(0, w)));
  };
  const teclado = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setHover((v) => Math.min(ultima, Math.max(0, (v ?? corte) + (e.key === 'ArrowRight' ? 1 : -1))));
  };

  return (
    <Detalle
      letra="C"
      eyebrow={`Semana 0 a ${ultima} · corte en semana ${corte}`}
      title="Curva S del proyecto"
      actions={<SmallButton icon={Table2} onClick={() => setTabla((t) => !t)}>{tabla ? 'Ver gráfico' : 'Ver tabla'}</SmallButton>}
    >
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]" aria-label="Leyenda">
        {SERIES.map((s) => (
          <span key={s.k} className="flex items-center gap-2">
            <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} strokeLinecap="round" /></svg>
            {s.label}
          </span>
        ))}
        <span className="flex items-center gap-2 text-muted">
          <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" /></svg>
          BAC
        </span>
      </div>

      {tabla ? (
        <div className="max-h-[340px] overflow-auto border border-line">
          <table className="w-full min-w-[520px] border-collapse font-mono text-[12.5px] tnum">
            <thead className="sticky top-0 bg-surface">
              <tr>{['Sem.', 'PV', 'EV', 'AC', 'SPI', 'CPI'].map((t) => <th key={t} className={`${TH} text-right first:pl-4 first:text-left`}>{t}</th>)}</tr>
            </thead>
            <tbody>
              {puntos.map((p) => (
                <tr key={p.semana} className={p.semana === corte ? 'bg-accent-soft' : ''}>
                  <td className="border-b border-line px-2 py-1.5 pl-4">{p.semana}{p.semana === corte ? ' · corte' : ''}</td>
                  {[money(p.pv), p.ev == null ? '—' : money(p.ev), p.ac == null ? '—' : money(p.ac), fmtNum(p.spi), fmtNum(p.cpi)].map((v, i) => (
                    <td key={i} className="border-b border-line px-2 py-1.5 text-right">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg
            width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" tabIndex={0}
            role="img" aria-label={`Curva S: a la semana ${corte}, PV ${money(puntos[corte].pv)}, EV ${money(puntos[corte].ev)}, AC ${money(puntos[corte].ac)}. Usa las flechas para recorrer las semanas.`}
            onKeyDown={teclado} onBlur={() => setHover(null)}
          >
            {ticksY.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
                <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fill="var(--muted)" fontFamily="var(--font-data)" fontSize="10.5">{corta(v)}</text>
              </g>
            ))}
            {ticksX.map((w) => (
              <text key={w} x={x(w)} y={H - m.b + 16} textAnchor="middle" fill="var(--muted)" fontFamily="var(--font-data)" fontSize="10.5">{w}</text>
            ))}
            <text x={W - m.r} y={H - 4} textAnchor="end" fill="var(--muted)" fontFamily="var(--font-data)" fontSize="10">SEMANA</text>
            <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="var(--fg)" strokeWidth="1.5" />

            <line x1={m.l} x2={W - m.r} y1={y(bac)} y2={y(bac)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" />
            <text x={m.l + 6} y={y(bac) - 6} fill="var(--muted)" fontFamily="var(--font-data)" fontSize="10.5">BAC {corta(bac)}</text>

            <line x1={x(corte)} x2={x(corte)} y1={m.t - 8} y2={y(0)} stroke="var(--fg)" strokeWidth="1" strokeDasharray="4 3" />
            <text x={x(corte)} y={m.t - 11} textAnchor={corte > ultima * 0.8 ? 'end' : 'middle'} fill="var(--fg)" fontFamily="var(--font-data)" fontSize="10.5" fontWeight="600">CORTE · SEM {corte}</text>

            {SERIES.map((s) => (
              <path key={s.k} d={linea(s.k)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {SERIES.filter((s) => s.k !== 'pv').map((s) => (
              <circle key={s.k} cx={x(corte)} cy={y(puntos[corte][s.k])} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
            ))}
            {fin.map((s) => (
              <g key={s.k}>
                <rect x={x(s.semana) + 8} y={s.ly - 4} width="8" height="8" fill={s.color} />
                <text x={x(s.semana) + 20} y={s.ly + 4} fill="var(--fg)" fontFamily="var(--font-data)" fontSize="11" fontWeight="600">
                  {s.corto}{compacto ? '' : ` ${corta(s.v)}`}
                </text>
              </g>
            ))}

            {h && (
              <g pointerEvents="none">
                <line x1={x(h.semana)} x2={x(h.semana)} y1={m.t} y2={y(0)} stroke="var(--fg)" strokeWidth="1" />
                {SERIES.filter((s) => h[s.k] != null).map((s) => (
                  <circle key={s.k} cx={x(h.semana)} cy={y(h[s.k])} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                ))}
              </g>
            )}
            <rect x={m.l} y={m.t} width={pw} height={H - m.t - m.b} fill="transparent" onMouseMove={mover} onMouseLeave={() => setHover(null)} />
          </svg>

          {h && (
            <div
              className="pointer-events-none absolute z-10 min-w-[170px] border border-fg bg-surface px-3 py-2 font-mono text-[11.5px] shadow-lg"
              style={{ top: m.t + 14, left: x(h.semana) > W * 0.6 ? x(h.semana) - 186 : x(h.semana) + 14 }}
            >
              <div className="mb-1 font-semibold">Semana {h.semana}{h.semana === corte ? ' · corte' : h.semana > corte ? ' · plan' : ''}</div>
              {SERIES.map((s) => (
                <div key={s.k} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2" style={{ background: s.color }} />{s.corto}</span>
                  <span className="tnum">{h[s.k] == null ? '—' : money(h[s.k])}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-line pt-1 text-muted"><span>SPI {fmtNum(h.spi)}</span><span>CPI {fmtNum(h.cpi)}</span></div>
            </div>
          )}
        </div>
      )}
      <p className="mt-3 font-mono text-[11.5px] text-muted">
        PV se proyecta hasta la semana {ultima} según la línea base. EV y AC son datos reales y llegan solo hasta el corte (semana {corte}); mueve el corte para recorrer el historial.
      </p>
    </Detalle>
  );
}

/** Modo línea base: el usuario solo mueve la semana de corte; PV/EV/AC se derivan. */
function CorteLineaBase({ project, evm, r, setEvm, money }) {
  const corte = project.evm.semana_corte;
  const maxSem = Math.max(1, corte, ...project.dod.map((d) => d.fin_semana_plan ?? 0));
  const planificados = project.dod.filter((d) => d.fin_semana_plan != null && d.fin_semana_plan <= corte).length;
  const ganados = project.dod.filter((d) => aprobadoAlCorte(d, corte)).length;
  const costos = project.evm.registro_costos.filter((c) => c.semana <= corte).length;
  const setCorte = (v) => setEvm({ semana_corte: Math.max(0, Math.round(Number(v) || 0)) });
  const filas = [
    ['PV', evm.pv, `${planificados} de ${project.dod.length} entregables con fin ≤ semana ${corte}`],
    ['EV', r.ev, `${ganados} entregable(s) aprobado(s) hasta el corte · regla 0/100`],
    ['AC', evm.ac, `${costos} registro(s) de costo hasta el corte`],
  ];
  return (
    <>
      <div>
        <Label htmlFor="evm-corte" hint={<span className="font-mono text-fg tnum">Semana {corte} de {maxSem}</span>}>Semana de corte</Label>
        <input id="evm-corte" type="range" min="0" max={maxSem} step="1" className="w-full" value={corte} onChange={(e) => setCorte(e.target.value)} />
        <div className="mt-1 flex justify-between font-mono text-[10.5px] text-muted"><span>0</span><span>{maxSem}</span></div>
      </div>
      <dl className="grid border border-fg">
        {filas.map(([k, v, nota], i) => (
          <div key={k} className={`grid grid-cols-[42px_minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2.5 ${i < filas.length - 1 ? 'border-b border-line' : ''}`}>
            <dt className="font-mono text-[12px] font-semibold text-muted">{k}</dt>
            <dd className="text-[12.5px] text-muted">{nota}</dd>
            <dd className="font-mono text-[15px] font-semibold tnum">{money(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="font-mono text-[11.5px] text-muted">% avance = EV / BAC = {fmtNum(evm.porcentaje_avance, 1)} %. Los valores salen de la línea base, las aprobaciones (L-02) y el registro de costos.</p>
    </>
  );
}

function LineaBaseTabla({ project, setProject, money }) {
  const corte = project.evm.semana_corte;
  const total = project.dod.reduce((s, d) => s + (Number(d.presupuesto) || 0), 0);
  const upd = (i, patch) => setProject((p) => updateDod(p, i, patch));
  const marca = (on) => <span className={`font-mono text-[13px] ${on ? 'font-semibold text-fg' : 'text-line'}`}>{on ? '●' : '○'}</span>;
  return (
    <Detalle letra="D" eyebrow="Paquetes de trabajo" title="Línea base por entregable" flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`${TH} pl-5`}>Código</th>
              <th className={TH}>Entregable</th>
              <th className={`${TH} w-32`}>Presupuesto</th>
              <th className={`${TH} w-20`}>Inicio</th>
              <th className={`${TH} w-20`}>Fin plan</th>
              <th className={`${TH} w-28`}>Estado</th>
              <th className={`${TH} w-12 text-center`} title="Planificado al corte">PV</th>
              <th className={`${TH} w-12 pr-5 text-center`} title="Ganado al corte">EV</th>
            </tr>
          </thead>
          <tbody>
            {project.dod.map((d, i) => (
              <tr key={d.codigo}>
                <td className={`${TD} py-2.5 pl-5 font-mono font-semibold text-redline`}>{d.codigo}</td>
                <td className={`${TD} py-2.5`}><span className="line-clamp-2">{d.entregable}</span></td>
                <td className={TD}><input id={`lb-pres-${i}`} aria-label={`Presupuesto ${d.codigo}`} type="number" min="0" step="any" className="cell font-mono tnum" value={d.presupuesto} onChange={(e) => upd(i, { presupuesto: Math.max(0, Number(e.target.value) || 0) })} /></td>
                <td className={TD}><input id={`lb-ini-${i}`} aria-label={`Semana de inicio ${d.codigo}`} type="number" min="0" step="1" placeholder="sem" className="cell font-mono tnum" value={d.inicio_semana_plan ?? ''} onChange={(e) => upd(i, { inicio_semana_plan: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))) })} /></td>
                <td className={TD}><input id={`lb-fin-${i}`} aria-label={`Semana de fin ${d.codigo}`} type="number" min="0" step="1" placeholder="sem" className="cell font-mono tnum" value={d.fin_semana_plan ?? ''} onChange={(e) => upd(i, { fin_semana_plan: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))) })} /></td>
                <td className={`${TD} py-2.5`}><EstadoSello estado={d.estado} /></td>
                <td className={`${TD} py-2.5 text-center`}>{marca(d.fin_semana_plan != null && d.fin_semana_plan <= corte)}</td>
                <td className={`${TD} py-2.5 pr-5 text-center`}>{marca(aprobadoAlCorte(d, corte))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-mono text-[12px]">
              <td className="px-2 py-2.5 pl-5" />
              <td className="px-2 py-2.5 text-right uppercase tracking-[0.06em] text-muted">BAC</td>
              <td className="px-2 py-2.5 font-semibold tnum">{money(total)}</td>
              <td colSpan={5} className="px-2 py-2.5 pr-5 text-muted">● cuenta al corte · ○ no cuenta</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Detalle>
  );
}

function RegistroCostos({ project, setProject, money, toast }) {
  const corte = project.evm.semana_corte;
  const [form, setForm] = useState({ semana: corte, entregable_codigo: project.dod[0]?.codigo ?? '', importe: '', descripcion: '' });
  const costos = [...project.evm.registro_costos].sort((a, b) => a.semana - b.semana);
  const acCorte = costos.reduce((s, c) => s + (c.semana <= corte ? Number(c.importe) || 0 : 0), 0);
  const nombre = (cod) => project.dod.find((d) => d.codigo === cod)?.entregable;

  const submit = (e) => {
    e.preventDefault();
    const importe = Number(form.importe);
    if (!form.entregable_codigo || !(importe >= 0) || form.importe === '') return;
    setProject((p) => addCost(p, { semana: Math.max(0, Math.round(Number(form.semana) || 0)), entregable_codigo: form.entregable_codigo, importe, descripcion: form.descripcion.trim() }));
    setForm((f) => ({ ...f, importe: '', descripcion: '' }));
    toast('ok', 'Costo registrado');
  };

  return (
    <Detalle letra="E" eyebrow={`AC al corte · ${money(acCorte)}`} title="Registro de costos" flush>
      <form onSubmit={submit} className="grid gap-2 border-b border-line p-4 sm:grid-cols-[72px_minmax(0,1fr)_110px]">
        <div>
          <Label htmlFor="c-sem">Sem.</Label>
          <input id="c-sem" type="number" min="0" className="field font-mono tnum" value={form.semana} onChange={(e) => setForm({ ...form, semana: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="c-ent">Entregable</Label>
          <select id="c-ent" className="field" value={form.entregable_codigo} onChange={(e) => setForm({ ...form, entregable_codigo: e.target.value })}>
            {project.dod.map((d) => <option key={d.codigo} value={d.codigo}>{d.codigo} · {d.entregable}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="c-imp">Importe</Label>
          <input id="c-imp" type="number" min="0" step="any" className="field font-mono tnum" value={form.importe} onChange={(e) => setForm({ ...form, importe: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <input id="c-desc" aria-label="Descripción del costo" placeholder="Descripción (horas × tarifa, factura, licencia…)" className="field" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
        </div>
        <SmallButton icon={Plus} type="submit" tone="primary" disabled={form.importe === '' || !form.entregable_codigo}>Registrar</SmallButton>
      </form>
      {costos.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-muted">Sin costos registrados. AC = 0 y el CPI queda sin datos hasta el primer registro.</p>
      ) : (
        <div className="max-h-[340px] overflow-auto">
          <table className="w-full min-w-[460px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`${TH} pl-5`}>ID</th>
                <th className={TH}>Sem.</th>
                <th className={TH}>Entregable</th>
                <th className={`${TH} text-right`}>Importe</th>
                <th className={`${TH} w-10 pr-5`} />
              </tr>
            </thead>
            <tbody>
              {costos.map((c) => {
                const fuera = c.semana > corte;
                return (
                  <tr key={c.id} className={fuera ? 'text-muted' : ''}>
                    <td className={`${TD} py-2 pl-5 font-mono`}>{c.id}</td>
                    <td className={`${TD} py-2 font-mono tnum`}>{c.semana}</td>
                    <td className={`${TD} py-2`}>
                      <span className="font-mono font-semibold text-redline">{c.entregable_codigo}</span>{' '}
                      <span className="text-[12px]">{c.descripcion || nombre(c.entregable_codigo)}</span>
                      {fuera && <span className="ml-1 font-mono text-[10.5px]">· fuera del corte</span>}
                    </td>
                    <td className={`${TD} py-2 text-right font-mono tnum`}>{money(Number(c.importe))}</td>
                    <td className={`${TD} py-1.5 pr-5`}><IconButton icon={Trash2} label={`Eliminar ${c.id}`} onClick={() => setProject((p) => removeCost(p, c.id))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Detalle>
  );
}

/** Índice de desempeño dibujado como cota sobre una regla 0–1,50 con referencia en 1,00. */
function Cota({ nombre, formula, valor, texto }) {
  const tone = valor == null ? 'text-muted' : valor >= 1 ? 'text-ok' : 'text-redline';
  const fill = valor == null ? 'bg-line' : valor >= 1 ? 'bg-ok' : 'bg-redline';
  const pos = valor == null ? null : Math.min(valor / 1.5, 1) * 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[19px] font-bold">{nombre} <span className="font-mono text-[12px] font-normal text-muted">{formula}</span></span>
        <span className={`font-mono text-[28px] font-semibold leading-none tnum ${tone}`}>{fmtNum(valor)}</span>
      </div>
      <div className="relative h-9" role="img" aria-label={`${nombre} ${fmtNum(valor)} sobre una escala de 0 a 1,50`}>
        <div className="absolute inset-x-0 top-4 h-px bg-fg" />
        <div className="absolute left-0 top-2.5 h-3.5 w-px bg-fg" />
        <div className="absolute right-0 top-2.5 h-3.5 w-px bg-fg" />
        <div className="absolute top-1 h-[26px] border-l border-dashed border-fg" style={{ left: '66.66%' }} />
        {pos != null && <div className={`absolute top-[9px] h-3.5 w-3.5 rotate-45 ${fill}`} style={{ left: `calc(${pos}% - 7px)` }} />}
        <span className="absolute left-0 top-6 font-mono text-[10px] text-muted">0,00</span>
        <span className="absolute top-6 -translate-x-1/2 font-mono text-[10px] text-fg" style={{ left: '66.66%' }}>1,00</span>
        <span className="absolute right-0 top-6 font-mono text-[10px] text-muted">1,50</span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{texto}</p>
    </div>
  );
}

// ===========================================================================
// Proyectos guardados y revisiones
// ===========================================================================
const fechaCorta = (iso) => {
  try {
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
};

function ProyectosPanel({ project, doc, dirty, busy, onClose, onSave, onOpen, onSaveAsNew, toast }) {
  const [lista, setLista] = useState(null); // null = cargando
  const [revs, setRevs] = useState([]);
  const [nota, setNota] = useState('');
  const [error, setError] = useState(null);
  const [confirmar, setConfirmar] = useState(null); // { tipo: 'abrir'|'eliminar', id, rev? }

  const cargar = async () => {
    try {
      setLista(await listProjects());
      setRevs(doc ? await listRevisions(doc.id) : []);
      setError(null);
    } catch (e) {
      setError(e.status ? e.message : `No hay conexión con el backend (${API_URL}).`);
      setLista([]);
    }
  };
  useEffect(() => { cargar(); }, [doc?.id, doc?.rev]);

  const abrir = async (id, rev) => {
    if (dirty && !(confirmar?.tipo === 'abrir' && confirmar.id === id && confirmar.rev === rev)) {
      setConfirmar({ tipo: 'abrir', id, rev });
      return;
    }
    try {
      const data = await getProject(id, rev);
      // Una revisión antigua se abre como base de una revisión nueva sobre la actual
      const antigua = rev && rev !== data.rev_actual;
      onOpen(data.project, { id, rev: data.rev_actual, ...(antigua ? { base: '' } : {}) });
      toast('ok', antigua ?`Revisión ${rev} abierta; al guardar será la revisión ${data.rev_actual + 1}` : `Proyecto abierto (Rev. ${data.rev})`);
    } catch (e) {
      toast('bad', e.message);
    }
  };

  const eliminar = async (id) => {
    if (!(confirmar?.tipo === 'eliminar' && confirmar.id === id)) {
      setConfirmar({ tipo: 'eliminar', id });
      return;
    }
    try {
      await deleteProject(id);
      toast('ok', 'Proyecto eliminado del servidor');
      setConfirmar(null);
      cargar();
    } catch (e) {
      toast('bad', e.message);
    }
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (await onSave(nota.trim())) setNota('');
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/35" onClick={onClose}>
      <aside
        className="hoja flex h-full w-full max-w-md flex-col !outline-0 shadow-2xl"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Proyectos guardados"
      >
        <div className="flex items-center justify-between border-b-2 border-fg px-5 py-4">
          <div>
            <div className="eyebrow">Archivo de planos</div>
            <h2 className="text-[22px] font-bold">Proyectos guardados</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 text-muted hover:bg-accent-soft"><X size={18} /></button>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
          <form onSubmit={guardar} className="flex flex-col gap-2 border border-fg bg-surface p-4">
            <div className="eyebrow">Proyecto en edición</div>
            <div className="font-display text-[17px] font-bold leading-tight">{project.nombre}</div>
            <div className="font-mono text-[11.5px] text-muted">
              {doc ? `Revisión ${doc.rev} en el servidor${dirty ? ' · cambios sin guardar' : ' · sin cambios'}` : 'Borrador: solo existe en este navegador'}
            </div>
            <Label htmlFor="rev-nota">Nota de la revisión</Label>
            <input id="rev-nota" className="field" placeholder="Corte semana 6, aprobación de E3…" value={nota} onChange={(e) => setNota(e.target.value)} />
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {doc && <SmallButton type="button" disabled={busy} onClick={async () => { if (await onSaveAsNew(nota.trim())) setNota(''); }}>Guardar como nuevo</SmallButton>}
              <SmallButton icon={Save} tone="primary" type="submit" disabled={busy || (doc && !dirty)}>
                {doc ? `Guardar revisión ${doc.rev + 1}` : 'Guardar en el servidor'}
              </SmallButton>
            </div>
          </form>

          {error && <div className="border-[1.5px] border-bad bg-surface px-3 py-2 text-[13px] text-bad">{error}</div>}

          {doc && revs.length > 0 && (
            <section>
              <div className="eyebrow mb-2">Historial de revisiones</div>
              <ol className="border-t border-line">
                {revs.map((r) => (
                  <li key={r.rev} className="flex items-center gap-3 border-b border-line py-2">
                    <span className="w-12 font-mono text-[13px] font-semibold text-redline">Rev. {r.rev}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{r.nota || 'Sin nota'}</span>
                      <span className="font-mono text-[10.5px] text-muted">{fechaCorta(r.creado)} · {r.errores ? `${r.errores} no conformes` : 'conforme'}</span>
                    </span>
                    {r.rev === doc.rev && !dirty ? (
                      <Sello tone="accent">Abierta</Sello>
                    ) : (
                      <SmallButton icon={History} onClick={() => abrir(doc.id, r.rev)}>
                        {confirmar?.tipo === 'abrir' && confirmar.id === doc.id && confirmar.rev === r.rev ? 'Descartar cambios y abrir' : 'Abrir'}
                      </SmallButton>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <div className="eyebrow mb-2">Todos los proyectos</div>
            {lista == null ? (
              <div className="flex items-center gap-2 text-[13px] text-muted"><LoaderCircle size={14} className="animate-spin" /> Cargando…</div>
            ) : lista.length === 0 ? (
              <p className="text-[13px] text-muted">Aún no hay proyectos guardados en el servidor.</p>
            ) : (
              <ul className="border-t border-line">
                {lista.map((x) => (
                  <li key={x.id} className={`flex items-center gap-3 border-b border-line py-2.5 ${doc?.id === x.id ? 'bg-accent-soft/60' : ''}`}>
                    <span className="min-w-0 flex-1 pl-1">
                      <span className="block truncate font-display text-[15px] font-bold">{x.nombre}</span>
                      <span className="font-mono text-[10.5px] text-muted">Rev. {x.rev_actual} · {fechaCorta(x.actualizado)}{x.errores ? ` · ${x.errores} no conformes` : ''}</span>
                    </span>
                    {doc?.id !== x.id && (
                      <SmallButton icon={FolderOpen} onClick={() => abrir(x.id)}>
                        {confirmar?.tipo === 'abrir' && confirmar.id === x.id && !confirmar.rev ? 'Descartar y abrir' : 'Abrir'}
                      </SmallButton>
                    )}
                    <SmallButton icon={Trash2} tone="danger" onClick={() => eliminar(x.id)}>
                      {confirmar?.tipo === 'eliminar' && confirmar.id === x.id ? 'Confirmar' : ''}
                    </SmallButton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="border-t-2 border-fg px-5 py-3 font-mono text-[11.5px] text-muted">
          Cada guardado crea una revisión nueva; las anteriores no se modifican.
        </div>
      </aside>
    </div>
  );
}

// ===========================================================================
// Hoja de observaciones (validación / exportación)
// ===========================================================================
const SECTION_LABEL = { proyecto: 'Proyecto', equipo: 'Equipo', dod: 'DoD', raci: 'RACI', riesgos: 'Riesgos', kpis: 'KPIs', evm: 'EVM' };

function IssuesPanel({ issues, panel, busy, onClose, onGo, onForce, onExportJson, onRetry }) {
  const list = (panel.report?.issues ?? issues).filter((i) => i.severity !== 'info');
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/35" onClick={onClose}>
      <aside
        className="hoja flex h-full w-full max-w-md flex-col !outline-0 shadow-2xl"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Hoja de observaciones"
      >
        <div className="flex items-center justify-between border-b-2 border-fg px-5 py-4">
          <div>
            <div className="eyebrow">{panel.report ? 'Respuesta del backend' : 'Validación en vivo'}</div>
            <h2 className="text-[22px] font-bold">Hoja de observaciones</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 text-muted hover:bg-accent-soft"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {panel.offline && (
            <div className="mb-4 border-[1.5px] border-bad bg-surface p-4 text-[13px]">
              <div className="mb-1 flex items-center gap-2 font-semibold text-bad"><ServerOff size={16} /> No hay conexión con el backend</div>
              <p className="mb-3">
                No se pudo llegar a <span className="font-mono">{API_URL}</span>. Inicia el servidor desde la raíz del repositorio con
                <span className="mt-1.5 block select-all border border-line bg-paper px-2 py-1 font-mono text-[12px]">uvicorn backend.main:app --reload</span>
                o guarda el proyecto como JSON para importarlo después.
              </p>
              <div className="flex flex-wrap gap-2">
                <SmallButton icon={FileJson} onClick={onExportJson}>Exportar proyecto (.json)</SmallButton>
                <SmallButton icon={RotateCcw} onClick={onRetry}>Reintentar</SmallButton>
              </div>
            </div>
          )}
          {panel.report && (
            <div className="mb-4 border-[1.5px] border-warn bg-surface p-4 text-[13px]">
              <p className="mb-3">
                El backend bloqueó la emisión por <b>{panel.report.errores} no conformidad(es)</b>. Corrígelas o emite un borrador igualmente.
              </p>
              <SmallButton icon={busy ? LoaderCircle : FileArchive} onClick={onForce} disabled={busy}>Emitir borrador igualmente</SmallButton>
            </div>
          )}
          {list.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-ok"><CircleCheck size={18} /> Sin no conformidades ni observaciones.</div>
          ) : (
            <ol className="flex flex-col">
              {list.map((i, n) => (
                <li key={n} className="border-b border-line last:border-0">
                  <button onClick={() => onGo(i.section)} className="flex w-full items-start gap-3 px-1 py-2.5 text-left hover:bg-accent-soft/60">
                    <span className="w-6 shrink-0 pt-0.5 font-mono text-[11px] text-muted tnum">{String(n + 1).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1 text-[13px]">
                      <span className={`mr-1.5 font-mono text-[11px] font-semibold ${i.severity === 'error' ? 'text-bad' : 'text-warn'}`}>
                        {i.severity === 'error' ? 'NO CONFORME' : 'OBSERVACIÓN'} · {i.code} · {SECTION_LABEL[i.section]}
                      </span>
                      <span className="block">{i.message}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="border-t-2 border-fg px-5 py-3 font-mono text-[11.5px] text-muted">
          Las no conformidades bloquean la emisión oficial; las observaciones no.
        </div>
      </aside>
    </div>
  );
}
