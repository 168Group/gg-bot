import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import type { SecretMetadata } from '../../../packages/module-sdk/src/browser.js';
import { api, ApiError, useSession } from './api.js';
import { Notice } from '../../../packages/ui/src/index.js';

/** Owner-only, reusable control. Plaintext never enters React Query or mutation caches. */
export function ModuleSecretsPanel({ moduleId }: { moduleId: string }) {
  const user = useSession(), [open, setOpen] = useState(false);
  if (user.access !== 'owner') return null;
  return <section className="module-secrets"><button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen(!open)}><KeyRound size={15}/>{open ? 'Close secrets' : 'Manage secrets'}</button>{open && <SecretFields key={moduleId} moduleId={moduleId}/>}</section>;
}
function SecretFields({ moduleId }: { moduleId: string }) {
  const [items, setItems] = useState<SecretMetadata[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<SecretMetadata[]>(`/api/module-secrets/${encodeURIComponent(moduleId)}`, 'GET', undefined, AbortSignal.timeout(15000)).then(data => { if (active) setItems(data); }).catch(() => { if (active) setError('Secret status could not be loaded. Check your owner access and storage connection.'); });
    return () => { active = false; };
  }, [moduleId]);
  return <div className="secret-fields"><p>Only owners can manage these credentials. Stored values stay hidden until you choose Show.</p>{error && <Notice error>{error}</Notice>}{!items && !error && <p>Loading secret status…</p>}{items?.map(item => <ModuleSecretControl key={item.name} moduleId={moduleId} initial={item}/>)}</div>;
}
export function ModuleSecretControl(props: { moduleId: string; initial: SecretMetadata }) {
  const user = useSession();
  return user.access === 'owner' ? <SecretControl {...props}/> : null;
}
function SecretControl({ moduleId, initial }: { moduleId: string; initial: SecretMetadata }) {
  const [metadata, setMetadata] = useState(initial), [draft, setDraft] = useState(''), [revealed, setRevealed] = useState('');
  const [showing, setShowing] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [failed, setFailed] = useState(false);
  const generation = useRef(0), mounted = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const path = `/api/module-secrets/${encodeURIComponent(moduleId)}/${encodeURIComponent(initial.name)}`;
  const clear = () => { generation.current++; setRevealed(''); setShowing(false); setDraft(''); if (timer.current) clearTimeout(timer.current); };
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.visibilityState === 'hidden') clear(); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', clear);
    return () => { mounted.current = false; generation.current++; if (timer.current) clearTimeout(timer.current); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', clear); };
  }, []);
  const fail = (error: unknown) => { setFailed(true); setNotice(error instanceof ApiError && error.status === 409 ? 'This secret changed. Close and reopen secrets to refresh its revision.' : 'This action failed. Check owner access, the shared encryption key and storage.'); };
  const reveal = async () => {
    clear(); setBusy(true); setShowing(true); setNotice('');
    const request = generation.current;
    try {
      const result = await api<{ value: string }>(`${path}/reveal`, 'POST', { revision: metadata.revision }, AbortSignal.timeout(15000));
      if (mounted.current && request === generation.current) { setRevealed(result.value); timer.current = setTimeout(clear, 30000); }
    } catch (error) { if (mounted.current && request === generation.current) { clear(); fail(error); } }
    finally { if (mounted.current) setBusy(false); }
  };
  const change = async (action: 'save' | 'disable' | 'environment') => {
    const value = draft;
    clear(); setBusy(true); setNotice(''); setFailed(false);
    try {
      const result = await api<SecretMetadata>(action === 'environment' ? `${path}/environment` : path, action === 'save' ? 'PUT' : action === 'disable' ? 'DELETE' : 'POST', { revision: metadata.revision, ...(action === 'save' ? { value } : {}) }, AbortSignal.timeout(15000));
      if (mounted.current) { setMetadata(result); setNotice(action === 'save' ? 'Secret saved. The next job will read the new value.' : action === 'disable' ? 'Secret disabled. An environment value will not be used.' : 'Environment fallback enabled. Availability is checked by the bot.'); }
    } catch (error) { if (mounted.current) fail(error); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="secret-card" aria-label={`${initial.name} secret`}>
    <div className="secret-heading"><strong>{initial.name}</strong><small>Revision {metadata.revision}</small></div>
    <p className="secret-source">{metadata.source === 'stored' ? 'Encrypted in storage' : metadata.source === 'disabled' ? 'Disabled, including environment fallback' : 'Bot environment · availability unknown'}</p>
    <div className="secret-value"><output aria-label={`${initial.name} value`}>{showing ? revealed || 'Loading…' : metadata.configured ? '••••••••' : 'No dashboard value'}</output>{showing ? <button type="button" onClick={clear}><EyeOff size={14}/>Hide</button> : metadata.canReveal && <button type="button" disabled={busy} onClick={() => { void reveal(); }}><Eye size={14}/>Show</button>}</div>
    {showing && <small>Hidden automatically after 30 seconds, when you leave, or when this tab is hidden.</small>}
    <label>Replace {initial.name}<input type="password" autoComplete="off" spellCheck={false} value={draft} maxLength={4096} disabled={busy} onChange={event => setDraft(event.target.value)}/></label>
    <div className="secret-actions"><button type="button" className="primary" disabled={busy || !draft} onClick={() => { void change('save'); }}>Save secret</button><button type="button" disabled={busy || metadata.source === 'disabled'} onClick={() => { void change('disable'); }}>Delete and disable</button>{metadata.source !== 'environment' && <button type="button" disabled={busy} onClick={() => { void change('environment'); }}>Use environment</button>}</div>
    {notice && <Notice error={failed}>{notice}</Notice>}
  </div>;
}
