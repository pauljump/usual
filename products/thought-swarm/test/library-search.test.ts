import {it,expect} from 'vitest';
import {sqliteDb} from '../src/sqlite.js';
import {SwarmStore} from '../src/store.js';
it('searches and filters the library with bounded pages and literal query characters',async()=>{
 const db=await sqliteDb(':memory:');const store=new SwarmStore(db);await store.init();
 for(let i=0;i<53;i++){
  const url=`https://${i<30?'apple.example':'sec.example'}/document-${i}`;
  await store.putDigest({key:String(i),url,content_hash:String(i),recipe:'test',title:i===2?'100% coverage':`Document ${String(i).padStart(2,'0')}`,digest_json:'{}',page_tokens:100,digest_tokens:10,created_at:1});
  await db.run('INSERT INTO library VALUES (?,?,?,?,?)',[url,'Example collection',i===52?'unavailable':'ready','',1]);
 }
 const first=await store.library();expect(first.entries).toHaveLength(24);expect(first.total).toBe(52);expect(first.ready).toBe(52);
 const second=await store.library({page:2});expect(second.entries).toHaveLength(24);expect(second.entries.some(e=>first.entries.some(f=>f.url===e.url))).toBe(false);
 const last=await store.library({page:999});expect(last.page).toBe(3);expect(last.entries).toHaveLength(4);
 expect((await store.library({q:'100%'})).total).toBe(1);
 expect((await store.library({q:'%'})).total).toBe(1);
 expect((await store.library({source:'apple.example'})).total).toBe(30);
 expect((await store.library({status:'unavailable'})).total).toBe(1);
 expect((await store.library({status:'all'})).total).toBe(53);
 expect((await store.library({q:'nonexistent'})).entries).toEqual([]);
 expect((await store.library({q:"' OR 1=1 --"})).total).toBe(0);
 expect((await store.library({page:NaN})).page).toBe(1);
});
