import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, WelcomeScreen, restoreElements, exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './style.css';
import { AssistantDock } from './AssistantDock';

window.EXCALIDRAW_ASSET_PATH = '/workspace/';
const API = '/workspace/api';
const clientId = crypto.randomUUID();
const paths = {
  arrow: <><path d="m9 18 6-6-6-6" /></>,
  back: <><path d="m12 19-7-7 7-7M5 12h14" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  cloud: <><path d="M7 18a5 5 0 0 1-1-9.9 6 6 0 0 1 11.7-1.2A5.5 5.5 0 0 1 18 18" /><path d="m9 15 3-3 3 3m-3-3v9" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  pen: <><path d="m16 3 5 5L9 20l-6 1 1-6Z" /><path d="m14 5 5 5" /></>,
  chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2v-9.5A9.5 9.5 0 0 1 10.5 3H13a8 8 0 0 1 8 8.5Z" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
  moon: <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4" /></>,
};
function Icon({ name, size = 18, ...props }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>; }
function Mark() { return <span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m8 21 5-13 5 15 6-12" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>; }
async function request(endpoint, options = {}) {
  const res = await fetch(API + endpoint, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error || '请求失败，请重试'), { status: res.status });
  return body;
}
const send = (endpoint, body, method = 'POST') => request(endpoint, { method, body: JSON.stringify(body) });
const date = value => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
function Modal({ title, children, close, actions }) {
  const ref = useRef();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); }, []);
  return <dialog ref={ref} className="modal" onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="关闭"><Icon name="close" /></button></div>{children}<div className="modal-actions">{actions}</div></dialog>;
}
function NameModal({ title, initial = '', submit, close, label = '保存' }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const commit = async e => { e.preventDefault(); if (!value.trim()) return; setBusy(true); try { await submit(value.trim()); close(); } catch (e) { setError(e.message); setBusy(false); } };
  return <Modal title={title} close={close} actions={<><button className="button" onClick={close}>取消</button><button className="button primary" type="submit" form="name-form" disabled={busy || !value.trim()}>{busy ? '处理中…' : label}</button></>}><form id="name-form" onSubmit={commit}><label className="field-label" htmlFor="canvas-name">画布名称</label><input id="canvas-name" className="text-field" autoFocus maxLength={120} value={value} onChange={e => setValue(e.target.value)} placeholder="给这个想法起个名字" /></form>{error && <p className="error-text" role="alert">{error}</p>}</Modal>;
}
function App() {
  const [route, setRoute] = useState(window.location.pathname);
  const [theme, setTheme] = useState(() => localStorage.getItem('canvas-theme') || 'light');
  const [toast, setToast] = useState('');
  const [assistantDocuments, setAssistantDocuments] = useState([]);
  const [chat, setChat] = useState(() => localStorage.getItem('canvas-assistant-open') === '1');
  const assistantHandlers = useRef(new Map());
  function prepareAssistant(document) {
    setAssistantDocuments(previous => {
      const existing = previous.find(item => item.id === document.id);
      if (existing && Object.entries(document).every(([key, value]) => existing[key] === value)) return previous;
      return existing ? previous.map(item => item.id === document.id ? { ...item, ...document } : item) : [...previous, document];
    });
  }
  function showAssistant(open) { setChat(open); localStorage.setItem('canvas-assistant-open', open ? '1' : '0'); }
  const timer = useRef();
  const navigationGuard = useRef(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  function notify(message) { setToast(message); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 4200); }
  async function navigate(url) {
    try { await navigationGuard.current?.(); history.pushState(null, '', url); setRoute(window.location.pathname); }
    catch (error) { notify(error.message); }
  }
  useEffect(() => {
    const onPop = async () => {
      const destination = window.location.pathname;
      try { await navigationGuard.current?.(); setRoute(destination); }
      catch (error) { history.pushState(null, '', routeRef.current); notify(error.message); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('canvas-theme', theme); }, [theme]);
  const id = route.startsWith('/canvas/') ? decodeURIComponent(route.slice(8)) : null;
  const shared = { navigate, notify, theme, chat, setChat: showAssistant, prepareAssistant, registerAssistant: (id, handlers) => { if (handlers) assistantHandlers.current.set(id, handlers); else assistantHandlers.current.delete(id); }, setNavigationGuard: guard => { navigationGuard.current = guard; }, toggleTheme: () => setTheme(theme === 'light' ? 'dark' : 'light') };
  return <><div className={`workspace${id ? ' editor-workspace' : ''}${id && chat ? ' assistant-open' : ''}`}><div className="page-view">{id ? <Editor key={id} id={id} {...shared} /> : <Library {...shared} />}</div><AssistantDock documents={assistantDocuments} currentId={id} open={chat} onClose={() => showAssistant(false)} onConnect={id => assistantHandlers.current.get(id)?.connect()} onKeyDown={(id, event) => assistantHandlers.current.get(id)?.keydown(event)} Icon={Icon} /></div>{toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}</>;
}
function Library({ navigate, notify, theme, toggleTheme, prepareAssistant }) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef();
  async function refresh() { try { const result = await request('/documents'); setItems(result.documents); setActiveId(result.activeId); const current = result.documents.find(item => item.id === result.activeId); if (current) prepareAssistant({ id: current.id, title: current.title }); setError(''); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { document.title = '画布库 · DeepSeek Harness'; refresh(); const visible = () => { if (!document.hidden) refresh(); }; document.addEventListener('visibilitychange', visible); return () => document.removeEventListener('visibilitychange', visible); }, []);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [menu]);
  const open = id => navigate(`/canvas/${encodeURIComponent(id)}`);
  async function create(title, scene) { const result = await send('/documents', { title, scene }); prepareAssistant({ id: result.document.id, title: result.document.title }); open(result.document.id); }
  async function importFile(e) {
    const file = e.target.files[0]; if (!file) return;
    setBusy(true);
    try { const scene = JSON.parse(await file.text()); if (!Array.isArray(scene.elements)) throw new Error('文件中没有有效的 Excalidraw 画布'); await create(file.name.replace(/\.excalidraw$|\.json$/i, ''), scene); }
    catch (e) { notify(`导入失败：${e.message}`); } finally { setBusy(false); e.target.value = ''; }
  }
  async function duplicate(item) { try { const { scene } = await request(`/documents/${encodeURIComponent(item.id)}`); const result = await send('/documents', { title: item.title + ' · 副本', scene }); prepareAssistant({ id: result.document.id, title: result.document.title }); await refresh(); notify('已在云端创建副本'); return result; } catch (e) { notify(e.message); } }
  const filtered = items.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh-CN') : b.updatedAt.localeCompare(a.updatedAt));
  const current = items.find(item => item.id === activeId);
  return <div className="library-layout">
    <aside className="sidebar"><a className="brand" href="/library/" onClick={e => { e.preventDefault(); navigate('/library/'); }}><Mark /><span>画布<span className="brand-sub">DeepSeek Harness</span></span></a>
      <div className="sidebar-caption">工作空间</div><button className="nav-item selected"><Icon name="grid" />所有画布<span>{items.length}</span></button>
      {current && <button className="nav-item" onClick={() => open(activeId)}><Icon name="pen" />继续绘图<Icon name="arrow" size={14} /></button>}
      <div className="sidebar-note"><span className="cloud-label"><Icon name="cloud" />云端工作空间</span><p>每一个想法，都有地方安放。<br />画布自动保存在服务器。</p><div className="shortcut">快速保存 <kbd>⌘ / Ctrl</kbd><kbd>S</kbd></div></div>
      <button className="theme-button" onClick={toggleTheme}><Icon name={theme === 'light' ? 'moon' : 'sun'} />{theme === 'light' ? '深色外观' : '浅色外观'}</button>
    </aside>
    <main className="library-main"><header className="library-topbar"><div className="breadcrumb">工作空间<Icon name="arrow" size={13} /><span>所有画布</span></div><span className="top-cloud"><span className="status-dot" />云端存储</span></header>
      <div className="library-content"><section className="library-heading"><div><span className="eyebrow">YOUR CREATIVE SPACE</span><h1>让想法，跃然纸上<span className="heading-dot">。</span></h1><p>草图、流程与灵感，都从一张画布开始。</p></div><div className="heading-actions"><button className="button" disabled={busy} onClick={() => importRef.current.click()}><Icon name="upload" />{busy ? '导入中…' : '导入画布'}</button><button className="button primary" onClick={() => setModal({ type: 'new' })}><Icon name="plus" />新建画布</button></div></section>
        <input type="file" accept=".excalidraw,.json" ref={importRef} hidden onChange={importFile} />
        {current && !query && <button className="continue-card" onClick={() => open(activeId)}><span className="continue-icon"><Icon name="pen" size={23} /></span><span className="continue-text"><small>接着上次的灵感</small><strong>{current.title}</strong></span><span className="continue-cta">继续编辑<Icon name="arrow" size={17} /></span></button>}
        <div className="library-tools"><div className="section-title">所有画布<span>{items.length}</span></div><div className="filter-tools"><label className="search-field"><Icon name="search" size={17} /><input aria-label="搜索画布" placeholder="搜索画布…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><Icon name="close" size={14} /></button>}</label><select aria-label="排序方式" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">最近更新</option><option value="name">名称排序</option></select></div></div>
        {error ? <div className="empty-state" role="alert"><Icon name="cloud" size={32} /><h2>暂时无法读取画布</h2><p>{error}</p><button className="button" onClick={refresh}>重新载入</button></div> : loading ? <div className="loading-state"><span className="spinner" />正在读取云端画布…</div> : <div className="canvas-grid">
          {!query && <button className="new-card" onClick={() => setModal({ type: 'new' })}><span><Icon name="plus" size={24} /></span><strong>一张新画布</strong><small>给下一个想法留点空间</small></button>}
          {filtered.map(item => <article className="canvas-card" key={item.id}><button className="card-preview" onClick={() => open(item.id)} aria-label={`打开 ${item.title}`}>{item.count ? <img src={`${API}/documents/${encodeURIComponent(item.id)}/preview?v=${encodeURIComponent(item.updatedAt)}`} loading="lazy" alt={item.title} onError={e => { e.target.style.display = 'none'; }} /> : <span className="blank-preview"><Icon name="file" size={34} /><span>空白画布</span></span>}{item.active && <span className="active-badge"><span className="status-dot" />正在使用</span>}<span className="preview-open">打开画布<Icon name="arrow" size={15} /></span></button><div className="card-meta"><div><button className="card-title" title={item.title} onClick={() => open(item.id)}>{item.title}</button><p>{date(item.updatedAt)}<span>·</span>{item.count} 个元素</p></div><div className="card-menu-wrap"><button className="icon-button" aria-label={`${item.title}的更多操作`} aria-expanded={menu === item.id} onClick={e => { e.stopPropagation(); setMenu(menu === item.id ? null : item.id); }}><Icon name="more" /></button>{menu === item.id && <div className="dropdown"><button onClick={() => setModal({ type: 'rename', item })}><Icon name="pen" />重命名</button><button onClick={() => duplicate(item)}><Icon name="copy" />创建副本</button><a href={`${API}/documents/${encodeURIComponent(item.id)}/export/excalidraw`} download><Icon name="download" />导出文件</a><button className="danger" onClick={() => setModal({ type: 'delete', item })}><Icon name="trash" />删除画布</button></div>}</div></div></article>)}
        </div>}
        {!loading && query && filtered.length === 0 && <div className="empty-state"><Icon name="search" size={32} /><h2>没有找到相关画布</h2><p>换个关键词试试。</p></div>}
        <footer className="library-footer"><span>由 Excalidraw 驱动 · 为灵感而建</span><span>保存在云端，随时继续</span></footer>
      </div>
    </main>
    {modal?.type === 'new' && <NameModal title="开始一张新画布" initial="未命名画布" label="创建画布" close={() => setModal(null)} submit={title => create(title)} />}
    {modal?.type === 'rename' && <NameModal title="重命名画布" initial={modal.item.title} close={() => setModal(null)} submit={async title => { await send(`/documents/${encodeURIComponent(modal.item.id)}`, { title }, 'PATCH'); await refresh(); notify('名称已更新'); }} />}
    {modal?.type === 'delete' && <Modal title="删除这张画布？" close={() => setModal(null)} actions={<><button className="button" onClick={() => setModal(null)}>取消</button><button className="button danger-button" onClick={async () => { try { await request(`/documents/${encodeURIComponent(modal.item.id)}`, { method: 'DELETE' }); setModal(null); refresh(); notify('画布已删除'); } catch (e) { notify(e.message); } }}>删除画布</button></>}><p className="modal-copy">「{modal.item.title}」将从云端删除，此操作无法撤销。</p>{modal.item.active && <p className="error-text">这张画布正在使用，请先打开另一张画布。</p>}</Modal>}
  </div>;
}

const persistentState = state => ({ viewBackgroundColor: state.viewBackgroundColor, gridSize: state.gridSize, gridStep: state.gridStep, gridModeEnabled: state.gridModeEnabled, objectsSnapModeEnabled: state.objectsSnapModeEnabled });
const sceneFrom = (elements, state, files) => ({ type: 'excalidraw', version: 2, source: 'dsh-canvas', elements, appState: persistentState(state), files });
const fingerprint = scene => JSON.stringify([scene.elements, persistentState(scene.appState || {}), scene.files || {}]);
function Editor({ id, navigate, notify, theme, toggleTheme, setNavigationGuard, chat, setChat, prepareAssistant, registerAssistant }) {
  const [loaded, setLoaded] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('saved');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(true);
  const [exportMenu, setExportMenu] = useState(false);
  const [copyModal, setCopyModal] = useState(false);
  const [count, setCount] = useState(0);
  const apiRef = useRef();
  const model = useRef({ scene: null, revision: 0, dirty: false, saving: null, timer: null, baseline: '', applying: false, firstChange: true, title: '', conflict: false, disposed: false });
  const encoded = encodeURIComponent(id);
  const autosave = useRef();
  function updateTitle(value) { model.current.title = value; setTitle(value); document.title = `${value} · 画布`; }
  function applyRemote(result) {
    const m = model.current;
    m.scene = result.scene; m.revision = result.document.revision;
    updateTitle(result.document.title);
    const api = apiRef.current;
    if (api) {
      m.applying = true;
      const elements = restoreElements(result.scene.elements, null);
      api.addFiles(Object.values(result.scene.files || {}));
      api.updateScene({ elements, appState: result.scene.appState, captureUpdate: 'NEVER' });
      requestAnimationFrame(() => {
        if (m.disposed) return;
        m.scene = sceneFrom(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles());
        m.baseline = fingerprint(m.scene); m.applying = false;
      });
    }
    setCount(result.document.count);
  }
  async function save(manual = false) {
    const m = model.current;
    clearTimeout(m.timer);
    if (!m.scene) return;
    if (m.conflict) throw new Error('请先保留为副本，或重新载入云端版本');
    if (m.saving) { await m.saving; if (m.dirty) return save(manual); return; }
    if (!m.dirty) { if (manual) notify('所有更改已保存到云端'); return; }
    setStatus('saving'); setError('');
    const snapshot = m.scene;
    const signature = fingerprint(snapshot);
    m.saving = send(`/documents/${encoded}`, { scene: snapshot, revision: m.revision, title: m.title, clientId }, 'PUT').then(result => {
      m.revision = result.document.revision;
      m.baseline = signature;
      m.dirty = fingerprint(m.scene) !== signature;
      if (!m.disposed) { setStatus(m.dirty ? 'pending' : 'saved'); if (manual) notify('已保存到云端'); }
    }).catch(e => {
      m.dirty = true;
      if (e.status === 423) {
        if (!m.disposed) { setStatus('pending'); m.timer = setTimeout(() => autosave.current(), 700); }
        throw e;
      }
      m.conflict = e.status === 409;
      if (!m.disposed) { setStatus('error'); setError(e.message); }
      throw e;
    }).finally(() => { m.saving = null; });
    await m.saving;
    if (m.dirty) m.timer = setTimeout(() => autosave.current(), 500);
  }
  autosave.current = () => save().catch(() => {});
  useEffect(() => {
    const m = model.current;
    let ws, reconnect;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/workspace/events`);
      ws.onopen = () => {
        request(`/documents/${encoded}`).then(result => {
          if (m.disposed) return;
          if (m.scene && result.document.revision !== m.revision) {
            if (m.dirty || m.saving) { m.conflict = true; setStatus('error'); setError('云端内容已更新，请保留为副本或重新载入。'); }
            else applyRemote(result);
          }
          if (m.dirty && !m.conflict) autosave.current();
        }).catch(e => setError(e.message));
      };
      ws.onmessage = async event => {
        const message = JSON.parse(event.data);
        if (message.type === 'connection') setConnected(message.connected);
        if (message.type === 'active') setActive(message.id === id);
        if (message.type === 'renamed' && message.document.id === id) updateTitle(message.document.title);
        if (message.type === 'scene' && message.document.id === id && message.source !== clientId) {
          if (m.dirty || m.saving) { m.conflict = true; clearTimeout(m.timer); setStatus('error'); setError('画布已由助手或其他窗口更新。请保留为副本，或重新载入云端版本。'); }
          else { applyRemote(message); setStatus('saved'); }
        }
        if (!apiRef.current || !model.current.scene || !model.current.active) return;
        const api = apiRef.current;
        if (message.type === 'set_viewport') {
          const ids = message.scrollToElementIds || (message.scrollToElementId ? [message.scrollToElementId] : null);
          if (message.scrollToContent || ids) api.scrollToContent(ids ? api.getSceneElements().filter(el => ids.includes(el.id)) : undefined, { fitToContent: true, viewportZoomFactor: message.viewportZoomFactor || 0.9, animate: true });
          if (message.zoom !== undefined || message.offsetX !== undefined || message.offsetY !== undefined) api.updateScene({ appState: { ...(message.zoom !== undefined ? { zoom: { value: message.zoom } } : {}), ...(message.offsetX !== undefined ? { scrollX: message.offsetX } : {}), ...(message.offsetY !== undefined ? { scrollY: message.offsetY } : {}) } });
          fetch('/api/viewport/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: message.requestId, success: true }) });
        }
        if (message.type === 'export_image_request') {
          try {
            const args = { elements: api.getSceneElements(), appState: { ...api.getAppState(), exportBackground: message.background !== false }, files: api.getFiles() };
            let data;
            if (message.format === 'svg') data = (await exportToSvg(args)).outerHTML;
            else { const blob = await exportToBlob({ ...args, mimeType: 'image/png' }); data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); }); }
            await fetch('/api/export/image/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: message.requestId, format: message.format, data, success: true, elementCount: api.getSceneElements().length }) });
          } catch (e) { console.error(e); }
        }
      };
      ws.onclose = () => { setConnected(false); if (!m.disposed) reconnect = setTimeout(connect, 2000); };
    };
    send(`/documents/${encoded}/open`, {}).then(result => {
      if (m.disposed) return;
      m.scene = result.scene; m.revision = result.document.revision; m.baseline = fingerprint(result.scene); m.active = result.document.active;
      updateTitle(result.document.title); setLoaded(result); setCount(result.document.count); setActive(result.document.active); connect();
    }).catch(e => setLoadError(e.message));
    const unload = e => { if (m.dirty || m.saving) { e.preventDefault(); e.returnValue = ''; } };
    const keydown = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) setCopyModal(true); else save(true).catch(() => {}); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); e.stopImmediatePropagation(); leave(); }
    };
    const visibility = () => { if (document.hidden && m.dirty && !m.conflict) autosave.current(); };
    prepareAssistant({ id });
    registerAssistant(id, { keydown, connect: connectAssistant });
    setNavigationGuard(() => save());
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', keydown, true); document.addEventListener('visibilitychange', visibility);
    return () => { registerAssistant(id, null); setNavigationGuard(null); m.disposed = true; clearTimeout(m.timer); clearTimeout(reconnect); ws?.close(); window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', keydown, true); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { model.current.active = active; if (loaded) prepareAssistant({ id, title, active }); }, [loaded, title, active]);
  useEffect(() => { if (!exportMenu) return; const close = () => setExportMenu(false); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [exportMenu]);
  function onChange(elements, state, files) {
    const m = model.current;
    if (!m.scene || m.applying || m.disposed) return;
    const scene = sceneFrom(elements, state, files);
    const signature = fingerprint(scene);
    setCount(elements.filter(el => !el.isDeleted).length);
    m.scene = scene;
    if (m.firstChange) { m.firstChange = false; m.baseline = signature; return; }
    if (signature === m.baseline) return;
    m.dirty = true; if (!m.conflict) setStatus('pending');
    clearTimeout(m.timer);
    if (!m.conflict) m.timer = setTimeout(() => autosave.current(), 700);
  }
  async function leave() { try { await save(); navigate('/library/'); } catch (e) { setError(e.message); } }
  async function renameTitle() {
    const value = model.current.title.trim() || loaded.document.title;
    updateTitle(value);
    try { await send(`/documents/${encoded}`, { title: value }, 'PATCH'); } catch (e) { setError(e.message); }
  }
  async function connectAssistant() {
    try { await save(); const result = await send(`/documents/${encoded}/open`, {}); applyRemote(result); setActive(result.document.active); }
    catch (e) { setError(e.message); }
  }
  async function exportFile(format) {
    try { await save(); const response = await fetch(`${API}/documents/${encoded}/export/${format}`); if (!response.ok) throw new Error((await response.json()).error); const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = `${model.current.title}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('导出文件已准备好'); } catch (e) { setError(e.message); }
  }
  if (loadError) return <div className="full-state"><Mark /><h2>无法打开画布</h2><p>{loadError}</p><button className="button primary" onClick={() => navigate('/library/')}>返回画布库</button><button className="button" onClick={() => location.reload()}>重试</button></div>;
  if (!loaded) return <div className="full-state"><span className="spinner" /><p>正在打开云端画布…</p></div>;
  return <div className="editor-layout">
    <header className="editor-header"><button className="icon-button back-button" onClick={leave} title="返回画布库（Ctrl / ⌘ O）" aria-label="返回画布库"><Icon name="back" /></button><Mark /><div className="document-heading"><input className="document-title" aria-label="画布名称" maxLength={120} value={title} onChange={e => updateTitle(e.target.value)} onBlur={renameTitle} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /><span className={`save-status ${status}`} aria-live="polite">{status === 'saving' ? <span className="spinner small" /> : <Icon name={status === 'saved' ? 'check' : 'cloud'} size={13} />}{status === 'saved' ? '已保存到云端' : status === 'saving' ? '正在保存…' : status === 'pending' ? '等待保存…' : '保存未完成'}</span></div>
      <div className="editor-actions"><button className="icon-button theme-toggle" onClick={toggleTheme} title="切换外观"><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><div className="export-wrap"><button className="button" aria-expanded={exportMenu} onClick={e => { e.stopPropagation(); setExportMenu(!exportMenu); }}><Icon name="download" /><span>导出</span></button>{exportMenu && <div className="dropdown export-dropdown">{['png', 'svg', 'excalidraw'].map(format => <button key={format} onClick={() => exportFile(format)}><Icon name={format === 'excalidraw' ? 'file' : 'download'} />{format === 'excalidraw' ? 'Excalidraw 源文件' : `${format.toUpperCase()} 图片`}</button>)}<hr /><button onClick={() => setCopyModal(true)}><Icon name="copy" />另存为云端副本</button></div>}</div><button className="button primary save-button" disabled={status === 'saving'} onClick={() => save(true).catch(() => {})}><Icon name="cloud" /><span>保存</span><kbd>⌘ / Ctrl S</kbd></button><button className={`button chat-button ${chat ? 'pressed' : ''}`} onClick={() => setChat(!chat)}><Icon name="chat" /><span>助手</span></button></div>
    </header>
    <div className="editor-notices">{error && <div className="editor-banner error-banner" role="alert"><span>{error}</span><div><button onClick={() => setCopyModal(true)}>保留为副本</button><button onClick={() => { if (!model.current.dirty || window.confirm('重新载入将放弃本地尚未保存的更改，继续？')) location.reload(); }}>重新载入</button><button onClick={() => save(true).catch(() => {})}>重试保存</button></div></div>}
    {!active && <div className="editor-banner"><span>助手当前连接了另一张画布。这张画布仍可编辑并保存到云端。</span><button onClick={connectAssistant}>让助手连接这张画布</button></div>}</div>
    <div className="editor-body"><main className="drawing-area"><Excalidraw excalidrawAPI={api => { apiRef.current = api; }} initialData={{ ...loaded.scene, scrollToContent: true }} onChange={onChange} theme={theme} langCode="zh-CN" name={title} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }}>
      <MainMenu><MainMenu.Item onSelect={() => save(true).catch(() => {})} icon={<Icon name="cloud" />} shortcut="Ctrl / ⌘ S">保存到云端</MainMenu.Item><MainMenu.Item onSelect={() => setCopyModal(true)} icon={<Icon name="copy" />}>另存为云端副本</MainMenu.Item><MainMenu.Item onSelect={leave} icon={<Icon name="grid" />}>打开画布库</MainMenu.Item><MainMenu.Separator /><MainMenu.Item onSelect={() => apiRef.current.updateScene({ appState: { gridModeEnabled: !apiRef.current.getAppState().gridModeEnabled } })} icon={<Icon name="grid" />}>切换网格</MainMenu.Item><MainMenu.Item onSelect={() => apiRef.current.updateScene({ appState: { objectsSnapModeEnabled: !apiRef.current.getAppState().objectsSnapModeEnabled } })}>切换对象吸附</MainMenu.Item><MainMenu.DefaultItems.CommandPalette /><MainMenu.DefaultItems.SearchMenu /><MainMenu.Separator /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ChangeCanvasBackground /><MainMenu.DefaultItems.Help /></MainMenu>
      <WelcomeScreen><WelcomeScreen.Center><WelcomeScreen.Center.Heading>给想法一点自由的空间</WelcomeScreen.Center.Heading><WelcomeScreen.Center.Menu><WelcomeScreen.Center.MenuItem onSelect={() => setChat(true)} icon={<Icon name="chat" />}>和助手一起画</WelcomeScreen.Center.MenuItem></WelcomeScreen.Center.Menu></WelcomeScreen.Center></WelcomeScreen>
    </Excalidraw></main></div>
    <footer className="editor-footer"><span><span className={`status-dot ${connected ? '' : 'offline'}`} />{connected ? active ? '助手已连接此画布' : '云端编辑' : '助手连接中断'}<span className="footer-divider" />{count} 个元素</span><span className="footer-hint">更改自动保存到云端<span className="footer-divider" />Ctrl / ⌘ S 立即保存</span></footer>
    {copyModal && <NameModal title="另存为云端副本" initial={title + ' · 副本'} label="保存副本" close={() => setCopyModal(false)} submit={async name => { const result = await send('/documents', { title: name, scene: model.current.scene }); model.current.dirty = false; model.current.conflict = false; prepareAssistant({ id: result.document.id, title: result.document.title }); notify('已保存为云端副本'); navigate(`/canvas/${result.document.id}`); }} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
