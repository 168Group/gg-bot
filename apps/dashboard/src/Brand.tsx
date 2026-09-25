/** A small, shared identity for the dashboard and installation console. */
export function Brand() {
  return <span className="brand-identity"><svg className="brand-symbol" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 9V5m-2 0h4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><rect x="3" y="10" width="34" height="27" rx="12" fill="currentColor"/><rect x="9" y="16" width="22" height="14" rx="6" fill="#24213e"/><path d="M14 22v2m12-2v2m-8 1q2 3 4 0" stroke="#f7eaff" strokeWidth="2.5" strokeLinecap="round"/></svg><span className="brand-name">OMO<span>Bot</span><small>by OMOWorlds</small></span></span>;
}

/** Decorative artwork only: it never represents a connection or health state. */
export function BotWorld({ compact = false }: { compact?: boolean }) {
  return <div className={`bot-world${compact ? ' compact' : ''}`} aria-hidden="true"><svg viewBox="0 0 380 300" fill="none">
    <ellipse cx="192" cy="150" rx="148" ry="103" stroke="#a997e9" strokeOpacity=".2" transform="rotate(-23 192 150)"/>
    <ellipse cx="192" cy="150" rx="110" ry="74" stroke="#a997e9" strokeOpacity=".15" transform="rotate(-23 192 150)"/>
    <g fill="#bca1f3"><circle cx="78" cy="63" r="2"/><circle cx="327" cy="122" r="2"/><circle cx="113" cy="248" r="2"/><circle cx="260" cy="38" r="2"/><circle cx="298" cy="248" r="2"/></g>
    <path d="m89 121 3 9 9 3-9 3-3 9-3-9-9-3 9-3Zm194 59 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#f6ca8e"/>
    <circle cx="75" cy="203" r="21" fill="#77abec"/><path d="M53 207c-17 15 37 12 47-11" stroke="#badbff" strokeWidth="5" strokeLinecap="round"/>
    <g transform="rotate(12 286 74)"><rect x="264" y="55" width="48" height="36" rx="14" fill="#f0aad2"/><path d="m277 87-3 11 16-9" fill="#f0aad2"/><path d="M279 72v1m9-1v1m9-1v1" stroke="#603b68" strokeWidth="4" strokeLinecap="round"/></g>
    <ellipse cx="190" cy="244" rx="62" ry="10" fill="#111326" fillOpacity=".3"/>
    <g className="bot-float" transform="rotate(-9 188 157)">
      <path d="M190 96V78" stroke="#e8d9ff" strokeWidth="6" strokeLinecap="round"/><circle cx="190" cy="74" r="8" fill="#f4c891"/>
      <rect x="117" y="137" width="20" height="37" rx="10" fill="#9974d8"/><rect x="243" y="137" width="20" height="37" rx="10" fill="#9974d8"/>
      <rect x="130" y="99" width="120" height="110" rx="38" fill="#9974d8"/><rect x="130" y="94" width="120" height="108" rx="38" fill="#d4b9ff"/>
      <path d="M151 107q17-9 30-7" stroke="#eee2ff" strokeWidth="5" strokeLinecap="round"/>
      <rect x="144" y="120" width="92" height="62" rx="23" fill="#292340"/>
      <path d="M162 145q5-8 10 0m35 0q5-8 10 0" stroke="#f6efff" strokeWidth="5" strokeLinecap="round"/>
      <path d="M182 154q8 13 16 0" stroke="#f6efff" strokeWidth="4" strokeLinecap="round"/>
      <ellipse cx="158" cy="157" rx="6" ry="3" fill="#eea9d1"/><ellipse cx="222" cy="157" rx="6" ry="3" fill="#eea9d1"/>
      <path d="m153 205-5 13m72-13 5 13" stroke="#cbb0f7" strokeWidth="12" strokeLinecap="round"/>
    </g>
  </svg><span className="world-caption">A little bot. A world of possibilities.</span></div>;
}
