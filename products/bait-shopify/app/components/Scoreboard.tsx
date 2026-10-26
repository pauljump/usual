import type { ReactNode } from 'react';
import type { Score } from '../bait/store.server';
const number=(n:number)=>n.toLocaleString('en-US');
const bytes=(n:string)=>{const v=Number(n);return v>=1e6?(v/1e6).toFixed(2)+' MB':v>=1e3?(v/1e3).toFixed(1)+' KB':v+' B'};
export function Scoreboard({score,controls,receipt,preview=false}:{score:Score;controls:ReactNode;receipt?:ReactNode;preview?:boolean}) {
  return <s-page heading="Bait" inlineSize="large">
    <div className="bait-layout">
      <div className="bait-main">
        {preview&&<s-banner tone="warning" heading="Local design preview">Illustrative fixture. These are not public bot counts. This page cannot activate a store.</s-banner>}
        <section className="bait-hero" aria-label="Your recorded score">
          <div className="bait-hero-top"><span className="bait-wordmark">bait.</span><span className="bait-status">{score.enabled?'Traps enabled':'Traps paused'}</span></div>
          <p className="bait-eyebrow">THEY CAME TO TAKE. LET THEM.</p>
          <h1>Help yourself<br/>to <span>nothing.</span></h1>
          <p className="bait-lede">A catalog full of things that don’t exist.<br/>One more page. One more wrong turn.</p>
          <div className="bait-score"><strong>{number(score.requests)}</strong><span>trap fetches recorded</span></div>
          <div className="bait-metrics">
            <div><strong>{number(score.records)}</strong><span>fake records generated</span></div>
            <div><strong>{number(score.deepRequests)}</strong><span>fetches 2+ levels deep</span></div>
            <div><strong>{bytes(score.bytes)}</strong><span>fake loot generated</span></div>
          </div>
          <div className="bait-receipt-bottom"><p>Real requests. Fictional inventory.<br/>Humans and retries can count too.</p>{receipt}</div>
        </section>
        <s-section heading="Their wrong turns">
          {score.recent.length?<div className="bait-table-wrap"><table className="bait-table"><thead><tr><th>When (UTC)</th><th>Door</th><th>Depth</th><th>Client says</th></tr></thead><tbody>
            {score.recent.map((e,i)=><tr key={e.at+i}><td>{new Date(e.at).toISOString().slice(11,19)}</td><td>{e.kind==='catalog'?'Catalog export':'Archive page'}</td><td>{e.depth}</td><td>{e.client.replace('declares-','')}</td></tr>)}
          </tbody></table></div>:<div className="bait-empty"><span aria-hidden="true">↳</span><h3>The shelves are stocked with nothing.</h3><p>The first visitor still has to take the bait. Your preview never earns points.</p></div>}
          <s-paragraph>Latest 20 recorded requests. Client labels are self-declared, not verified identities. A visit does not prove malicious intent.</s-paragraph>
        </s-section>
        <s-section heading="The receipt, without the theater">
          <s-paragraph>We count accepted requests to Bait’s own doors and the records and bytes we generate. We cannot confirm downloads or measure a visitor’s CPU, time or money spent. This is not a count of every bot on your store.</s-paragraph>
          <s-paragraph>Deepest recorded door: {number(score.deepest)}. {score.lastRecordedAt?'Last recorded request: '+new Date(score.lastRecordedAt).toISOString()+'.':'No recorded requests yet.'}</s-paragraph>
        </s-section>
      </div>
      <aside className="bait-aside">
        <s-section heading="Set the table">{controls}</s-section>
        <s-section heading="Our turf. Our nonsense.">
          <s-unordered-list><s-list-item>Nothing is added to your real catalog.</s-list-item><s-list-item>No checkout or customer account changes.</s-list-item><s-list-item>No shopper tracking pixel.</s-list-item><s-list-item>Quick responses. No slow connections on your storefront.</s-list-item></s-unordered-list>
        </s-section>
        <s-section heading="Keep the joke on their side">
          <div className="bait-budget"><strong>{number(score.today)}</strong><span> / {number(score.dailyCap)} daily trap fetches</span></div>
          <s-paragraph>When the daily trap budget is reached, these doors take a break. Resets at midnight UTC. Your real store keeps its own routes.</s-paragraph>
          <s-paragraph>Shared-network reporting: <strong>off</strong>. Your store’s observations stay in this app’s private storage. There is no data resale or external feed in this release.</s-paragraph>
        </s-section>
      </aside>
    </div>
  </s-page>;
}
