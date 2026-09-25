import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { api, useSession } from '../../apps/dashboard/src/api.js';
import { SectionTitle, Notice, Badge } from '../../packages/ui/src/index.js';
import type { ModuleState } from '../../packages/module-sdk/src/browser.js';
import type { ModuleRecord } from '../../packages/module-sdk/src/services.js';
type TaskResult = { greeting: string; completedAt: string; jobId: string };
type Job = { state: string; error: string | null; result: {message:string} | null };
export default function ExamplePage() {
  const user = useSession(), cache = useQueryClient();
  const state = useQuery({ queryKey: ['example'], queryFn: () => api<ModuleState>('/api/modules/example/settings'), refetchInterval: 2000 });
  const savedTask = useQuery({ queryKey: ['example-task'], queryFn: () => api<ModuleRecord<TaskResult> | null>('/api/modules/example/last-task'), refetchInterval: 2000 });
  const [greeting, setGreeting] = useState(''), [revision, setRevision] = useState(0), [jobId, setJobId] = useState(''), [dirty, setDirty] = useState(false);
  const job = useQuery({ queryKey: ['module-job', jobId], queryFn: () => api<Job>(`/api/jobs/${jobId}`), enabled: Boolean(jobId), refetchInterval: query => ['completed','failed','expired'].includes(query.state.data?.state ?? '') ? false : 1000 });
  useEffect(() => { if (!dirty && state.data && state.data.desiredRevision !== revision) { setGreeting((state.data.settings as { greeting: string }).greeting); setRevision(state.data.desiredRevision); } }, [state.data, revision, dirty]);
  const save = useMutation({ mutationFn: () => api('/api/modules/example/settings', 'PUT', { revision, settings: { greeting } }), onSuccess: async () => { await cache.invalidateQueries({ queryKey: ['example'] }); setDirty(false); } });
  const run = useMutation({ mutationFn: () => api<{id:string}>('/api/modules/example/tasks', 'POST', { key: crypto.randomUUID() }), onSuccess: result => { setJobId(result.id); } });
  const active = state.data?.enabled && state.data.appliedEnabled && state.data.desiredRevision === state.data.appliedRevision && !state.data.applyError && !save.isPending && (state.data.settings as {greeting:string}).greeting === greeting;
  const pending = run.isPending || Boolean(jobId && (!job.data && !job.error || ['pending','sending'].includes(job.data?.state ?? '')));
  return <><SectionTitle eyebrow="YOUR MODULES / EXAMPLE" title="Small module. Same foundation." description="A working starting point for your community’s own ideas: saved settings, a Discord command, and background tasks."/>
    <div className="configuration-grid"><form className="panel settings-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}><div className="panel-heading"><h2>Give it a little personality.</h2><Sparkles size={20}/></div><label>Greeting<input value={greeting} maxLength={100} onChange={event => { setGreeting(event.target.value); setDirty(true); }} disabled={user.access === 'viewer' || !revision || save.isPending}/></label><p>Enable this module in Modules, then try /example ping in your server.</p><button className="primary" disabled={user.access === 'viewer' || save.isPending || !revision}>Save greeting</button>{save.error && <Notice error>{save.error.message}</Notice>}{state.error && <Notice error>{state.error.message}</Notice>}{save.isSuccess && <Notice>Greeting saved. The bot will apply it when this module is enabled.</Notice>}</form>
    <section className="panel settings-form"><div className="panel-heading"><h2>Try a background task.</h2><Badge tone={active ? 'good' : 'warn'}>{active ? 'Ready' : 'Not active'}</Badge></div><p>This task remembers your greeting in the module’s own storage. Its result survives a restart.</p><button className="primary" disabled={user.access === 'viewer' || !active || pending} onClick={() => run.mutate()}>Remember greeting <ArrowRight size={16}/></button>{!active && <p className="notice">Enable this module and wait for its settings to apply first.</p>}{pending && <Notice>Waiting for the bot to finish your task…</Notice>}{run.error && <Notice error>{run.error.message}</Notice>}{job.error && <Notice error>{job.error.message}</Notice>}{job.data?.state === 'completed' && <Notice><CheckCircle2 size={16}/>Task completed. Your greeting is remembered.</Notice>}{['failed','expired'].includes(job.data?.state ?? '') && <Notice error>{job.data?.error ?? 'This task expired before it could finish. Check the bot and try again.'}</Notice>}{savedTask.error && <Notice error>{savedTask.error.message}</Notice>}{savedTask.data && <div className="embed-preview"><span className="eyebrow">LAST REMEMBERED GREETING</span><p>{savedTask.data.value.greeting}</p><small>{new Date(savedTask.data.value.completedAt).toLocaleString()}</small></div>}</section></div>
  </>;
}
