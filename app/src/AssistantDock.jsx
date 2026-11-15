import React, { useState } from 'react';

// This dock belongs to App, so editor navigation and collapsing the sidebar
// never unmount an already prepared assistant or reset its input/scroll state.
export function AssistantDock({ documents, currentId, open, onClose, onConnect, onKeyDown, Icon, mode = 'cloud' }) {
  const [versions, setVersions] = useState({});
  const [copied, setCopied] = useState('');
  if (mode === 'desktop') {
    const document = documents.find(item => item.id === currentId);
    if (!document) return null;
    const prompt = `请先调用 canvas_select，canvasId 为 ${document.id}，再用 canvas_context 确认目标；本会话只编辑这张画布「${document.title || document.id}」。`;
    return <aside className={`chat-panel persistent-assistant${open ? ' assistant-visible' : ''}`} aria-hidden={!open} inert={open ? undefined : ''}>
      <div className="chat-heading"><div><Icon name="chat" /><strong>Desktop 助手</strong></div><button className="icon-button" onClick={onClose} aria-label="收起助手"><Icon name="close" /></button></div>
      <div className="desktop-assistant"><span className="desktop-badge">本机工作空间</span><h2>在 Desktop 中继续对话</h2><p>为这张画布新建一个 DSH Desktop 对话，发送下面的指令。以后回到同一对话即可继续，输入和历史由 Desktop 保留。</p><label htmlFor="desktop-canvas-prompt">{document.title || document.id}</label><textarea id="desktop-canvas-prompt" readOnly value={prompt} onFocus={event => event.target.select()} /><button className="button primary" onClick={async () => { await navigator.clipboard.writeText(prompt); setCopied(document.id); }}>{copied === document.id ? '已复制指令' : '复制绑定指令'}</button><p>画布更改自动保存到本机工作目录。切换到另一张图时，请使用对应的 Desktop 对话。</p>{document.active === false && <button className="button" onClick={() => onConnect(document.id)}>让助手连接这张画布</button>}</div>
    </aside>;
  }
  return documents.map(document => {
    const title = document.title || document.id;
    const visible = open && document.id === currentId;
    const paused = document.active === false;
    const version = versions[document.id] || 0;
    const src = `/dsh/login?canvas=${encodeURIComponent(document.id)}${version ? `&t=${version}` : ''}`;
    return <aside key={document.id} className={`chat-panel persistent-assistant${visible ? ' assistant-visible' : ''}${paused ? ' assistant-paused' : ''}`} aria-hidden={!visible} inert={visible ? undefined : ''} data-canvas={document.id}>
      <div className="chat-heading"><div><Icon name="chat" /><strong>画布助手</strong></div><button className="icon-button" onClick={onClose} aria-label="收起助手"><Icon name="close" /></button></div>
      <p className="chat-context">{title}<button onClick={() => setVersions(previous => ({ ...previous, [document.id]: Date.now() }))}>重新连接</button></p>
      <iframe src={src} loading="eager" title={`画布助手 · ${title}`} tabIndex={visible && !paused ? 0 : -1} onLoad={event => {
        event.currentTarget.contentWindow.addEventListener('keydown', key => onKeyDown(document.id, key), true);
      }} />
      {paused && <div className="chat-paused"><Icon name="chat" size={28} /><p>助手当前连接了另一张画布</p><button className="button" onClick={() => onConnect(document.id)}>连接这张画布</button></div>}
    </aside>;
  });
}
