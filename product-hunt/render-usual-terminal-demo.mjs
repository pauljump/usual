import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const frames = path.join(root, '.usual-terminal-demo-frames');
const output = path.join(root, 'usual-terminal-demo.mp4');
const fps = 24;
const duration = 16;
const width = 1080;
const height = 1080;

rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const opacity = (time, start) => clamp((time - start) / 0.35);
const typed = (value, time, start, end) => {
  if (time < start) return '';
  const progress = clamp((time - start) / (end - start));
  return value.slice(0, Math.max(1, Math.floor(value.length * progress)));
};

function text(value, x, y, size, color, options = {}) {
  const family = options.family ?? 'SFNSMono';
  const weight = options.weight ?? '400';
  const anchor = options.anchor ?? 'start';
  const opacityValue = options.opacity ?? 1;
  return `<text x="${x}" y="${y}" fill="${color}" font-family="${family}" font-size="${size}px" font-weight="${weight}" text-anchor="${anchor}" opacity="${opacityValue}">${esc(value)}</text>`;
}

function terminalLine(value, y, color, time, start, size = 32) {
  if (time < start) return '';
  return text(value, 88, y, size, color, { opacity: opacity(time, start) });
}

function captionFor(time) {
  if (time < 2.4) return ['Your coding agent asks the same little questions.'];
  if (time < 5.1) return ['Usual brings your past decisions into the room.'];
  if (time < 7.8) return ['It finds the choice that fits this context.'];
  if (time < 10.6) return ['The agent makes the routine call', 'and keeps building.'];
  if (time < 13.4) return ['Review what happened.', 'Correct it when needed.'];
  return ['Local decision memory for coding agents.'];
}

function frameSvg(time) {
  const command = typed('> /usual build a reading-list app', time, 1.25, 2.55);
  const question = typed('? SQLite or another service?', time, 3.8, 4.85);
  const found = typed('found  "Keep personal tools local."', time, 5.7, 6.9);
  const answer = typed('-> SQLite. Carrying on.', time, 7.7, 8.8);
  const cursor = Math.floor(time * 2) % 2 === 0 ? '▌' : '';
  const captions = captionFor(time);
  const captionLines = captions.map((line, index) => text(
    line,
    width / 2,
    904 + index * 38,
    index === 0 && captions.length === 1 ? 30 : 28,
    '#252920',
    { family: 'Avenir Next', weight: '600', anchor: 'middle' },
  )).join('');
  const progress = Math.round(clamp(time / duration) * 860);
  const reviewOpacity = opacity(time, 10.6);
  const contextOpacity = opacity(time, 13.7);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="1080" height="1080" fill="#0f1318"/>
  <rect x="58" y="58" width="964" height="964" rx="3" fill="#161a20" stroke="#46505d" stroke-width="4"/>
  <rect x="58" y="58" width="964" height="80" fill="#252c36"/>
  <circle cx="95" cy="98" r="7" fill="#e7502d"/>
  <circle cx="121" cy="98" r="7" fill="#e0b35c"/>
  <circle cx="147" cy="98" r="7" fill="#78a878"/>
  ${text('usual / illustrative terminal session', 190, 106, 22, '#aeb7c2')}
  ${text('LOCAL DECISION MEMORY', 88, 190, 20, '#e7502d', { weight: '700' })}
  ${text('claude / reading-list', 88, 248, 24, '#7e8995')}
  ${text(command + cursor, 88, 316, 34, '#f6f4eb', { opacity: command ? 1 : 0 })}
  ${text(question, 88, 400, 34, '#f0c674', { opacity: question ? 1 : 0 })}
  ${text(found, 88, 484, 34, '#8fc39a', { opacity: found ? 1 : 0 })}
  ${terminalLine('past / reading-list / source attached', 530, '#7e8995', time, 6.65, 24)}
  ${text(answer, 88, 620, 38, '#f6f4eb', { opacity: answer ? 1 : 0 })}
  ${terminalLine('decision recorded  /  review afterward', 670, '#8fc39a', time, 8.85, 25)}
  ${text('review  [agree]  [correct]  [leave out]', 88, 756, 28, '#aeb7c2', { opacity: reviewOpacity })}
  ${text('context still matters.', 88, 756, 28, '#e0b35c', { opacity: contextOpacity })}
  <line x1="88" y1="792" x2="${88 + progress}" y2="792" stroke="#e7502d" stroke-width="3"/>
  <rect x="58" y="826" width="964" height="196" fill="#f6f4eb"/>
  ${text('USUAL', 88, 866, 20, '#e7502d', { family: 'Avenir Next', weight: '700' })}
  ${captionLines}
  ${text('tryusual.com  ·  open source  ·  MIT', 88, 988, 22, '#686b60', { family: 'Avenir Next' })}
  </svg>`;
}

for (let index = 0; index < fps * duration; index += 1) {
  const time = index / fps;
  const name = `frame-${String(index).padStart(4, '0')}`;
  const svg = path.join(frames, `${name}.svg`);
  const png = path.join(frames, `${name}.png`);
  writeFileSync(svg, frameSvg(time));
  execFileSync('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', png, svg]);
}

execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-framerate', String(fps),
  '-i', path.join(frames, 'frame-%04d.png'),
  '-t', String(duration),
  '-an',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', output,
]);

rmSync(frames, { recursive: true, force: true });
console.log(output);
