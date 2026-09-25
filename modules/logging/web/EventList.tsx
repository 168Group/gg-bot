import { Link } from 'react-router-dom';
import { ArrowRight, Hash, Plus, Pencil, Minus } from 'lucide-react';
import { Badge, Empty } from '../../../packages/ui/src/index.js';
import type { LogEvent } from '../shared/settings.js';
const labels: Record<string, string> = { 'channel.created': 'Channel created', 'channel.updated': 'Channel updated', 'channel.deleted': 'Channel deleted', 'logging.test': 'Delivery test' };
export function EventList({ events }: { events: LogEvent[] }) {
  if (!events.length) return <Empty title="A fresh page for your community">Channel activity will appear here once logging is enabled. Configure a destination to get started.</Empty>;
  return <div className="event-list">{events.map(event => <Link className="event-row" key={event.id} to={`/modules/logging/events/${event.id}`}><span className={`event-icon ${event.type.split('.')[1]}`}>{event.type.endsWith('created') ? <Plus size={17}/> : event.type.endsWith('deleted') ? <Minus size={17}/> : <Pencil size={15}/>}</span><div className="event-main"><strong>{labels[event.type] ?? event.type}</strong><span><Hash size={12}/>{event.subjectLabel}</span></div><div className="event-meta"><Badge tone={event.deliveryState === 'sent' ? 'good' : event.deliveryState === 'blocked' || event.deliveryState === 'failed' ? 'bad' : 'neutral'}>{event.deliveryState ?? 'Stored'}</Badge><time dateTime={event.observedAt}>{new Date(event.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><ArrowRight className="event-arrow" size={15}/></Link>)}</div>;
}
