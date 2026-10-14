fetch('/teek/api/rooms',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(({rooms})=>{
  const list=document.querySelector('#rooms');
  for(const room of rooms){const a=document.createElement('a');a.className='room';a.href=room.url;const h=document.createElement('h3');h.textContent=room.name+' ↗';const p=document.createElement('p');p.textContent='Config-driven room · its own allowance and archive';a.append(h,p);list.append(a);}
  document.querySelector('#room-status').textContent=rooms.length?`${rooms.length} config-driven room${rooms.length===1?'':'s'}.`:'No additional rooms registered yet. Start with the template below.';
}).catch(()=>{document.querySelector('#room-status').textContent='Room list unavailable. Refresh or sign in again.';});
