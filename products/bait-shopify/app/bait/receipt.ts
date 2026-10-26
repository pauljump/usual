import type { Score } from './store.server';
export function scoreText(s:Score) {
  return `Bait: ${s.requests.toLocaleString('en-US')} trap fetches. ${s.records.toLocaleString('en-US')} fake catalog records generated. ${s.deepRequests.toLocaleString('en-US')} fetches two or more levels deep.\n\nFake goods. Real busywork.\nRecorded ${s.generatedAt}. Requests can include humans and retries.`;
}
export function receiptSvg(s:Score) {
  // Only numeric totals and a validated ISO timestamp are interpolated.
  const n=(v:number)=>Math.max(0,Math.floor(v)).toLocaleString('en-US');
  const date=new Date(s.generatedAt).toISOString().slice(0,10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#171916"/><g fill="#f3f4ed" font-family="Arial,sans-serif"><text x="80" y="110" font-size="32">bait.</text><text x="80" y="205" font-size="52" font-weight="700">Fake goods. Real busywork.</text><text x="80" y="365" font-size="112" fill="#e2f778" font-weight="700">${n(s.requests)}</text><text x="80" y="420" font-size="30">trap fetches</text><text x="80" y="520" font-size="34">${n(s.records)} fake records generated</text><text x="80" y="575" font-size="34">${n(s.deepRequests)} fetches two or more levels deep</text><text x="80" y="690" font-size="21">Recorded ${date}. Requests may include humans and retries.</text><text x="80" y="730" font-size="21">Generated records are not confirmed downloads or unique products.</text></g></svg>`;
}
