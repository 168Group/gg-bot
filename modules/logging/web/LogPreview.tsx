import type { ReactNode } from 'react';

export interface PreviewEmbed {
  title: string; description: string; color: number;
  fields: { name: string; value: string; inline: boolean }[];
}
function PreviewText({ text }: { text: string }) {
  const result: ReactNode[] = [];
  let position = 0;
  // Decode only our escaping and synthetic mentions. Never interpret user text as HTML.
  for (const match of text.matchAll(/\\([\\`*_{}[\]()<>#|~])|<(#|@&|@)(\d{17,20})>/g)) {
    result.push(text.slice(position, match.index));
    if (match[1]) result.push(match[1]);
    else {
      const label = match[2] === '#' ? '#sample-channel' : match[2] === '@' ? '@Sample member'
        : match[3] === '100000000000000003' ? '@Previous role' : '@New role';
      result.push(<span className="log-preview-mention" key={match.index} title={`Sample ID: ${match[3]}`}>{label}</span>);
    }
    position = match.index + match[0].length;
  }
  result.push(text.slice(position));
  return <>{result}</>;
}
export function LogPreview({ embed }: { embed: PreviewEmbed }) {
  return <div className="embed-preview log-preview" style={{ borderLeftColor: `#${embed.color.toString(16).padStart(6, '0')}` }}>
    <span className="eyebrow">PREVIEW · NOT SENT</span><h4>{embed.title}</h4><p><PreviewText text={embed.description}/></p>
    <div className="log-preview-fields">{embed.fields.map(field => <div className="log-preview-field" data-inline={field.inline} key={field.name}>
      <strong>{field.name}</strong><p><PreviewText text={field.value}/></p>
    </div>)}</div>
    <small>Sample data · Discord resolves mentions when sent.</small>
  </div>;
}
