import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { api, useSession, useWorkspace, workspaceQueryKey } from '../../apps/dashboard/src/api.js';
import { ModuleSecretsPanel } from '../../apps/dashboard/src/ModuleSecrets.js';
import { SectionTitle, Notice, Badge, Empty } from '../../packages/ui/src/index.js';
import type { CatalogChannel } from '../../packages/module-sdk/src/browser.js';
import type { ModuleRecord } from '../../packages/module-sdk/src/services.js';
import { definition, type EventSettings } from './definition.js';
import { eventTime, upcoming, type AnnouncementPreview, type FixtureSnapshot } from './fixtures.js';
import type { Draft } from './drafts.js';
import LiveEventsPanel from './LiveEventsPanel.js';
import './web.css';
type Page<T> = { records: ModuleRecord<T>[]; nextCursor: string | null };
type Job = { state: string; error: string | null; result: { message: string } | null };
const root = '/api/modules/gottagacha-events';
export default function EventsPage() {
  const user = useSession(), cache = useQueryClient(), admin = user.access !== 'viewer';
  const workspace = useWorkspace(), state = { ...workspace, data: workspace.data?.modules.find(module => module.moduleId === definition.manifest.id) };
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<CatalogChannel[]>('/api/catalog/channels') });
  const [settings, setSettings] = useState<EventSettings>(definition.defaultSettings), [revision, setRevision] = useState(0), [dirty, setDirty] = useState(false), [jobId, setJobId] = useState('');
  const [previewCursor, setPreviewCursor] = useState(''), [draftCursor, setDraftCursor] = useState('');
  useEffect(() => { if (!dirty && state.data && state.data.desiredRevision !== revision) { setSettings(state.data.settings as EventSettings); setRevision(state.data.desiredRevision); } }, [state.data, revision, dirty]);
  const apiMode = (state.data?.settings as EventSettings | undefined)?.mode === 'api-readonly';
  const fixtureMode = (state.data?.settings as EventSettings | undefined)?.mode === 'fixtures';
  const snapshot = useQuery({ queryKey: ['gg-events-snapshot'], queryFn: () => api<ModuleRecord<FixtureSnapshot> | null>(`${root}/snapshot`), enabled: fixtureMode, refetchInterval: 2000 });
  const previews = useQuery({ queryKey: ['gg-events-previews', previewCursor], queryFn: () => api<Page<AnnouncementPreview>>(`${root}/previews?cursor=${encodeURIComponent(previewCursor)}`), enabled: fixtureMode, refetchInterval: 2000 });
  const drafts = useQuery({ queryKey: ['gg-events-drafts', draftCursor], queryFn: () => api<Page<Draft>>(`${root}/drafts?cursor=${encodeURIComponent(draftCursor)}`), enabled: fixtureMode && admin, refetchInterval: 2000 });
  const job = useQuery({ queryKey: ['module-job', jobId], queryFn: () => api<Job>(`/api/jobs/${jobId}`), enabled: Boolean(jobId), refetchInterval: query => ['completed', 'failed', 'expired'].includes(query.state.data?.state ?? '') ? false : 1000 });
  const save = useMutation({ mutationFn: () => api(`${root}/settings`, 'PUT', { revision, settings }), onSuccess: async () => { await cache.invalidateQueries({ queryKey: workspaceQueryKey }); setDirty(false); } });
  const refresh = useMutation({ mutationFn: () => api<{ id: string }>(`${root}/refresh-fixtures`, 'POST', { key: crypto.randomUUID() }), onSuccess: value => { setJobId(value.id); setPreviewCursor(''); } });
  const active = fixtureMode && state.data?.enabled && state.data.appliedEnabled && state.data.desiredRevision === state.data.appliedRevision && !state.data.applyError;
  const pending = refresh.isPending || Boolean(jobId && !job.error && !['completed', 'failed', 'expired'].includes(job.data?.state ?? ''));
  const edit = (value: Partial<EventSettings>) => { setSettings(previous => ({ ...previous, ...value })); setDirty(true); };
  const events = fixtureMode && snapshot.data ? upcoming(snapshot.data.value.events) : [];
  return <div className="gg-events">
    <SectionTitle eyebrow="GOTTAGACHA / EVENTS" title="A little more to look forward to." description="Help your community find its next gathering. Browse public events or explore a safe preview." action={<Badge tone="warn">{apiMode ? 'API read-only' : fixtureMode ? 'Fixture preview' : 'Not connected'}</Badge>}/>
    <Notice>{apiMode ? "Read-only API mode. Private bookings are filtered before caching. No event writes or announcements are enabled." : "Fixture previews use sample data only. Select API read-only mode to browse public GottaGacha events after configuring the bot secret."}</Notice>
    {user.access === 'owner' && <section className="panel settings-form"><div className="panel-heading"><h2>API key</h2><Badge>Owner access</Badge></div><p>Add a GottaGacha key with events:read access. It stays hidden until you choose Show. A replacement is used by the next event refresh.</p><ModuleSecretsPanel moduleId={definition.manifest.id}/></section>}
    <div className="configuration-grid">
      <form className="panel settings-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
        <div className="panel-heading"><h2>Set the stage.</h2><CalendarDays size={22}/></div>
        <fieldset disabled={!admin || !revision || save.isPending}>
          <label>Event source<select value={settings.mode} onChange={event => edit({ mode: event.target.value as EventSettings['mode'] })}><option value="disconnected">Not connected</option><option value="fixtures">Fixture preview</option><option value="api-readonly">GottaGacha API (read-only)</option></select></label>
          {settings.mode === 'api-readonly' && <Notice>{user.access === 'owner' ? 'Use Manage secrets above to configure a key with events:read access.' : 'Ask an owner to configure a key with events:read access.'} Keys are checked when you refresh events. Test keys access the same database as live keys.</Notice>}
          <h3>Staff draft channels</h3><p>In fixture mode, administrators can create review-only drafts here. Choose private staff channels.</p>
          {channels.data?.filter(channel => channel.type === 0).map(channel => <label className="check-row" key={channel.id}><input type="checkbox" checked={settings.staffChannelIds.includes(channel.id)} disabled={!channel.canSend} onChange={event => edit({ staffChannelIds: event.target.checked ? [...settings.staffChannelIds, channel.id] : settings.staffChannelIds.filter(id => id !== channel.id) })}/><span>#{channel.name}{!channel.canSend && ' (unavailable)'}</span></label>)}
          {!channels.data?.length && <p>Connect the bot to load available channels.</p>}
          <button className="primary" disabled={save.isPending}>Save event settings</button>
        </fieldset>
        {!admin && <Notice>You have read-only access. An administrator can configure this module.</Notice>}
        {state.isPending && <p>Loading settings…</p>}
        {[state.error, channels.error, save.error].filter(Boolean).map((error, i) => <Notice error key={i}>{error!.message}</Notice>)}
        {state.data?.applyError && <Notice error>{state.data.applyError}</Notice>}
        {save.isSuccess && !dirty && <Notice>Settings saved. Enable the module in Modules and wait for the bot to apply them.</Notice>}
      </form>
      {apiMode ? <LiveEventsPanel state={state.data} dirty={dirty || save.isPending}/> : <section className="panel settings-form">
        <div className="panel-heading"><h2>Upcoming gatherings</h2><Badge tone={active ? 'good' : 'warn'}>{active ? 'Preview ready' : 'Preview inactive'}</Badge></div>
        <p>Fixed sample dates demonstrate the layout. These are not real GottaGacha events.</p>
        <button className="primary" disabled={!admin || !active || dirty || save.isPending || pending} onClick={() => refresh.mutate()}><RefreshCw size={16}/>Refresh sample events</button>
        {!active && <p>Select Fixture preview, save, and enable GottaGacha events in Modules.</p>}
        {pending && <Notice>Waiting for the bot to refresh the fixtures…</Notice>}
        {jobId && job.data && <Notice error={['failed', 'expired'].includes(job.data.state)}>Job {job.data.state}: {job.data.error ?? job.data.result?.message ?? 'Waiting for the worker.'}</Notice>}
        {[refresh.error, job.error, fixtureMode && snapshot.error].filter(Boolean).map((error, i) => <Notice error key={i}>{(error as Error).message}</Notice>)}
        {fixtureMode && snapshot.isPending && <p>Loading sample events…</p>}
        {!events.length && <Empty title="Your next gathering starts here.">Refresh the fixtures to explore sample events. For live events, select API read-only mode and configure the bot service.</Empty>}
        {events.map(event => <article className="gg-event-card" key={event.id}><span className="eyebrow">SAMPLE EVENT</span><h3>{event.title}</h3><p>{eventTime(event)}</p><small>{event.location}</small></article>)}
        {fixtureMode && snapshot.data && <small>Last fixture refresh: {new Date(snapshot.data.value.refreshedAt).toLocaleString()}</small>}
      </section>}
    </div>
    {fixtureMode && <section className="panel settings-form"><div className="panel-heading"><h2>Announcement previews</h2><Badge>Never sent</Badge></div><p>Repeated refreshes reuse previews for seven days. Changed and cancelled sample revisions get their own preview.</p>
      {previews.error && <Notice error>{previews.error.message}</Notice>}
      {!previews.data?.records.length && <p>No previews yet. Refresh the sample events to create them.</p>}
      <div className="gg-preview-grid">{previews.data?.records.map(record => <article className="embed-preview" key={record.key}><pre>{record.value.text}</pre></article>)}</div>
      <div className="gg-page-actions">{previewCursor && <button onClick={() => setPreviewCursor('')}>First previews</button>}{previews.data?.nextCursor && <button onClick={() => setPreviewCursor(previews.data!.nextCursor!)}>Next previews</button>}</div>
    </section>}
    <section className="panel settings-form"><div className="panel-heading"><h2>Draft together. Review first.</h2><Badge>Publishing unavailable</Badge></div><p>Draft previews work in Fixture preview mode only. In a configured staff channel, start with <code>event:</code> and add one labeled field per line. Dates need an explicit offset and timezone. Drafts expire after 24 hours.</p>
      <pre className="gg-example">{'event:\nTitle: Sample game night\nStarts: 2030-05-10T18:00:00-04:00\nTimezone: America/Detroit\nLocation: Sample gathering space'}</pre>
      {fixtureMode && admin && <>{drafts.error && <Notice error>{drafts.error.message}</Notice>}{!drafts.data?.records.length && <p>No staff drafts to review yet.</p>}{drafts.data?.records.map(record => <article className="gg-event-card" key={record.key}><span className="eyebrow">FIXTURE DRAFT • REVIEW ONLY</span><h3>{record.value.fields.title ?? 'Untitled draft'}</h3><dl>{Object.entries(record.value.fields).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{record.value.issues.length ? <ul>{record.value.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>Parsed details are ready for review.</p>}<small>Review ID: {record.value.id}<br/>Expires: {record.value.expiresAt}</small></article>)}<div className="gg-page-actions">{draftCursor && <button onClick={() => setDraftCursor('')}>First drafts</button>}{drafts.data?.nextCursor && <button onClick={() => setDraftCursor(drafts.data!.nextCursor!)}>Next drafts</button>}</div></>}
      <Notice>Review never creates an event. The API does not deduplicate creation requests, so publishing remains blocked until explicit confirmation and uncertain-result handling are implemented.</Notice>
    </section>
  </div>;
}
