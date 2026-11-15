import React, { useState } from 'react';

// This dock belongs to App, so editor navigation and collapsing the sidebar
// never unmount an already prepared assistant or reset its input/scroll state.
export function AssistantDock({ documents, currentId, open, onClose, onConnect, onKeyDown, Icon }) {
  const [versions, setVersions] = useState({});
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
