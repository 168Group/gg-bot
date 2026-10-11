import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api, useSession } from '../../apps/dashboard/src/api.js';
import type { ModuleState } from '../../packages/module-sdk/src/browser.js';
import { Badge, Empty, Notice } from '../../packages/ui/src/index.js';
import { liveView, VENUE_TIMEZONE, venueTime, type LiveView } from './live-model.js';
type Job = { state: string; error: string | null; result: { message: string } | null };
export default function LiveEventsPanel({ state, dirty }: { state: ModuleState | undefined; dirty: boolean }) {
  const user = useSession(), cache = useQueryClient();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const active = state?.enabled && state.appliedEnabled && !state.applyError && state.desiredRevision === state.appliedRevision;
  const snapshot = useQuery({ queryKey: ['gg-events-api', state?.appliedRevision], queryFn: () => api<LiveView | null>('/api/modules/gottagacha-events/api-snapshot'), enabled: Boolean(active), refetchInterval: 5 * 60_000 });
  const [jobId, setJobId] = useState('');
  const job = useQuery({ queryKey: ['module-job', jobId], queryFn: () => api<Job>(`/api/jobs/${jobId}`), enabled: Boolean(jobId), refetchInterval: query => ['completed', 'failed', 'expired'].includes(query.state.data?.state ?? '') ? false : 3000 });
  useEffect(() => { if (job.data && ['completed', 'failed', 'expired'].includes(job.data.state)) void cache.invalidateQueries({ queryKey: ['gg-events-api'] }); }, [job.data, cache]);
  const run = useMutation({ mutationFn: () => api<{ id: string }>('/api/modules/gottagacha-events/refresh-api', 'POST', { key: crypto.randomUUID() }), onSuccess: result => { setJobId(result.id); void cache.invalidateQueries({ queryKey: ['gg-events-api'] }); } });
  const pending = run.isPending || Boolean(jobId && !job.error && !['completed', 'failed', 'expired'].includes(job.data?.state ?? ''));
  const view = snapshot.error || !snapshot.data ? null : liveView(snapshot.data, state?.appliedRevision ?? 0, now);
  const fresh = active && view?.state === 'ready';
  const cooldown = view && view.nextRefreshAt > now;
  return <section className="panel settings-form gg-live-panel">
    <div className="panel-heading"><h2>This week in Warren</h2><Badge tone={fresh ? 'good' : 'warn'}>{fresh ? 'Recent API snapshot' : 'Needs refresh'}</Badge></div>
    <p>Juunni refreshes public events automatically every hour, even when this page is closed. Use the button for changes you want to check sooner.</p>
    <p>In Discord, try <code>@Juunnii events</code> or mention the bot and ask “Any events coming up?” You can also use <code>/events upcoming</code>.</p>
    <button className="primary" disabled={user.access === 'viewer' || !active || dirty || pending || Boolean(cooldown)} onClick={() => run.mutate()}><RefreshCw size={16}/>Refresh from GottaGacha</button>
    {!active && <Notice>Enable the module and wait for its settings to apply. An owner can configure the API key in Manage secrets before refreshing.</Notice>}
    {cooldown && <small>You can refresh again when the cooldown ends.</small>}
    {snapshot.isPending && <p>Loading event information…</p>}
    {pending && <Notice>Waiting for the bot to read the upcoming week…</Notice>}
    {[snapshot.error, job.error, run.error].filter(Boolean).map((error, index) => <Notice error key={index}>{error!.message}</Notice>)}
    {job.data && <Notice error={['failed', 'expired'].includes(job.data.state)}>Job {job.data.state}: {job.data.error ?? job.data.result?.message ?? 'Waiting for the worker.'}</Notice>}
    {view && <Notice error={view.state === 'unavailable'}>{view.message}</Notice>}
    {!fresh && !snapshot.isPending && <Empty title="Current events need a refresh.">The bot will check again on its hourly schedule. Event information is hidden after 75 minutes, a failed refresh or a settings change.</Empty>}
    {fresh && <><small>{view!.window.startDate} to {view!.window.endDate}. Times are local to Warren, not UTC.</small>
      {!view!.events.length && <Empty title="No public events returned.">No public events were returned for this date range. Missing events are not proof of cancellation.</Empty>}
      {view!.events.map(event => <article className="gg-event-card" key={event.key}><span className="eyebrow">PUBLIC API EVENT</span><h3>{event.title}</h3><p>{venueTime(event)}</p>{event.location && <small>{event.location}</small>}</article>)}
      {view!.truncated && <Notice>Showing {view!.events.length} of {view!.publicOccurrenceCount} public occurrences returned. The display is limited in size.</Notice>}
      <small>Last checked: {new Date(view!.refreshedAt!).toLocaleString('en-US', { timeZone: VENUE_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' })} (America/Detroit). This page checks for updates every five minutes.</small>
    </>}
  </section>;
}
