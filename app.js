'use strict';
const $=id=>document.getElementById(id), STATION=60003760, REGION=10000002;
const isk=n=>Number(n).toLocaleString('en-GB',{maximumFractionDigits:0})+' ISK';
const sort=(a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'});
let dataset=null,results=[];
const ordersCache=new Map();
function parseInventory(text){
 const map=new Map(),bad=[];
 text.split(/\r?\n/).forEach((line,i)=>{
  if(!line.trim())return;
  const parts=line.split('\t').map(s=>s.trim());let name='',qty=1;
  if(parts.length>=2){
   if(/^\d[\d,]*$/.test(parts[1])){name=parts[0];qty=Number(parts[1].replaceAll(',',''))}
   else if(/^\d[\d,]*$/.test(parts[0])){name=parts[1];qty=Number(parts[0].replaceAll(',',''))}
   else{bad.push(i+1);return}
  }else{
   const m=line.trim().match(/^(.*?)\s{2,}(\d[\d,]*)(?:\s{2,}.*)?$/);
   if(m){name=m[1].trim();qty=Number(m[2].replaceAll(',',''))}else name=line.trim();
  }
  if(!name||!Number.isSafeInteger(qty)||qty<1){bad.push(i+1);return}
  const key=name.toLowerCase(),old=map.get(key);
  map.set(key,{name:old?.name||name,qty:(old?.qty||0)+qty});
 });return{items:[...map.values()].sort(sort),bad};
}
async function loadData(){
 try{const r=await fetch('./eve-data.json',{cache:'no-cache'});if(!r.ok)throw Error(`HTTP ${r.status}`);
  const data=await r.json();if(!data.items||Object.keys(data.items).length<1000)throw Error('Incomplete dataset');
  dataset=data.items;$('dataStatus').textContent=`✓ Automatic EVE material data loaded (${Object.keys(dataset).length.toLocaleString()} recipes; ${data.generated?.slice(0,10)||'date unknown'}).`;
 }catch(err){dataset=null;$('dataStatus').textContent='⚠ Automatic EVE material data not yet available. Run the GitHub Actions “Update EVE reprocessing data” workflow. Details: '+err.message}
}
async function getOrders(typeId){
 if(ordersCache.has(typeId))return ordersCache.get(typeId);
 const job=(async()=>{let all=[];
  for(let page=1;page<=100;page++){
   const url=`https://esi.evetech.net/latest/markets/${REGION}/orders/?order_type=buy&type_id=${typeId}&page=${page}`;
   const response=await fetch(url);if(!response.ok)throw Error(`ESI error ${response.status} for type ${typeId}`);
   const data=await response.json();if(!Array.isArray(data))throw Error('Unexpected ESI response');
   all.push(...data.filter(o=>o.location_id===STATION&&o.is_buy_order===true&&o.volume_remain>0));
   const pages=Number(response.headers.get('x-pages')||1);if(page>=pages)break;
   if(page===100)throw Error('Too many market pages; cannot verify full buy-order depth');
  }return all.sort((a,b)=>b.price-a.price);
 })();ordersCache.set(typeId,job);try{return await job}catch(e){ordersCache.delete(typeId);throw e}
}
function fillValue(orders,qty){let left=qty,total=0;for(const o of orders){if(left<=0)break;const take=Math.min(left,o.volume_remain);total+=take*o.price;left-=take}return left===0?total:null}
async function price(typeId,qty){return fillValue(await getOrders(typeId),qty)}
function makeRow(item){
 const wrap=document.createElement('div'),d=document.createElement('div');d.className='item';
 const left=document.createElement('div');
 const name=document.createElement('button');name.textContent=item.name;name.title='Copy item name';
 name.onclick=async()=>{try{await navigator.clipboard.writeText(item.name);name.textContent='✓ Copied: '+item.name;setTimeout(()=>name.textContent=item.name,1200)}catch(e){$('status').textContent='Clipboard permission denied. Please allow clipboard access.'}};
 left.append(name);const right=document.createElement('span');right.className='number';right.textContent='×'+item.qty+(item.best==null?'':'  '+isk(item.best));d.append(left,right);wrap.append(d);
 if(item.reason){const note=document.createElement('div');note.className='hint bad';note.textContent=item.reason;wrap.append(note)}
 if(item.action==='REPROCESS'){
  const note=document.createElement('div');note.className='hint note';
  note.textContent=item.sell==null?`Sell: unavailable (insufficient Jita buy-order volume) · Melt: ${isk(item.rep)} · Difference: unknown`:`Sell: ${isk(item.sell)} · Melt: ${isk(item.rep)} · Extra: ${isk(item.rep-item.sell)}`;
  wrap.append(note);
 }return wrap;
}
function render(){
 const query=$('search').value.trim().toLocaleLowerCase();
 for(const [id,action] of [['sell','SELL'],['rep','REPROCESS']]){
  const all=results.filter(x=>x.action===action).sort(sort),list=all.filter(x=>x.name.toLocaleLowerCase().includes(query)),el=$(id);el.replaceChildren();
  if(!list.length)el.textContent=all.length?'No matching items':'No items';else list.forEach(x=>el.append(makeRow(x)));
  const countId=action==='SELL'?'sellcount':action==='REPROCESS'?'repcount':'reviewcount';
  $(countId).textContent=`(${all.length}${query?' · '+list.length+' shown':''})`;
 }
 const valued=results.filter(x=>x.action!=='REVIEW');
 const comparable=valued.filter(x=>x.sell!=null);
 const total=valued.reduce((s,x)=>s+x.best,0);
 const extra=comparable.reduce((s,x)=>s+x.best-x.sell,0);
 const sellTotal=valued.filter(x=>x.action==='SELL').reduce((s,x)=>s+x.best,0);
 const meltTotal=valued.filter(x=>x.action==='REPROCESS').reduce((s,x)=>s+x.rep,0);
 const sellBaseline=comparable.reduce((s,x)=>s+x.sell,0);
 const missingSell=valued.length-comparable.length;
 const reviewCount=results.length-valued.length;
 const summary=$('summary');summary.replaceChildren();
 function addCard(parent,label,value,{icon,kind,description}={}){
  const card=document.createElement('div');card.className='summary-card'+(kind?' '+kind:'');
  const title=document.createElement('div');title.className='summary-label'+(icon?' with-icon':'');
  if(icon){const img=document.createElement('img');img.src=icon;img.alt='';img.setAttribute('aria-hidden','true');title.append(img)}
  const titleText=document.createElement('span');titleText.textContent=label;title.append(titleText);
  const amount=document.createElement('div');amount.className='summary-value'+(kind==='gain'?' gain':'');amount.textContent=value;
  card.append(title,amount);
  if(description){const note=document.createElement('p');note.className='summary-description';note.textContent=description;card.append(note)}
  parent.append(card);
 }
 const baselineSection=document.createElement('section');baselineSection.className='summary-section';
 const baselineHeading=document.createElement('h3');baselineHeading.textContent='1. If you sold everything';baselineSection.append(baselineHeading);
 addCard(baselineSection,'Total ISK from selling everything to Jita buy orders',
  results.length && missingSell===0 && reviewCount===0 ? isk(sellBaseline) : (comparable.length ? isk(sellBaseline)+' (partial)' : 'Unavailable'),
  {icon:'sell-icon.png',description:missingSell || reviewCount ?
   'Only items with verified full-stack buy orders are included. This is NOT a complete sell-everything total.' :
   'Estimated proceeds if you sell every imported item directly to Jita 4-4 buy orders.'});
 summary.append(baselineSection);
 const recommended=document.createElement('section');recommended.className='summary-section';
 const recommendedHeading=document.createElement('h3');recommendedHeading.textContent='2. Following Every Little Bit\'s recommendations';recommended.append(recommendedHeading);
 const grid=document.createElement('div');grid.className='summary-grid';
 addCard(grid,'ISK from selling',isk(sellTotal),{icon:'sell-icon.png',description:'Value of items the calculator recommends selling.'});
 addCard(grid,'ISK from reprocessing',isk(meltTotal),{icon:'reprocess-icon.png',description:'Value of recovered materials sold to Jita buy orders.'});
 recommended.append(grid);
 addCard(recommended,'Total potential ISK',isk(total),{description:'Combined estimated value from the recommended SELL and REPROCESS lists.'});
 addCard(recommended,'Extra ISK from using Every Little Bit','+'+isk(extra),{kind:'gain',description:'Additional potential ISK compared with selling the same comparable items directly to buy orders. Already included in the total above.'});
 summary.append(recommended);
 if(missingSell){const warning=document.createElement('p');warning.className='bad';warning.textContent=`⚠ ${missingSell} recommended item type(s) lack a verified direct-sale value. The sell-everything baseline is partial, and their reprocessing value is not counted as verified extra ISK.`;summary.append(warning)}
 if(reviewCount){const warning=document.createElement('p');warning.className='bad';warning.textContent=`⚠ ${reviewCount} item type(s) could not be valued and are excluded from the totals. See the calculation status; export CSV for reasons.`;summary.append(warning)}
 $('export').disabled=!results.length;$('copysell').disabled=!results.some(x=>x.action==='SELL');$('copyrep').disabled=!results.some(x=>x.action==='REPROCESS');
}
async function calculate(){
 const btn=$('go');if(btn.disabled)return;btn.disabled=true;results=[];
 try{
  const{items,bad}=parseInventory($('inventory').value);if(!items.length)throw Error('Paste valid EVE item rows first.');
  const y=Number($('yield').value)/100,t=Number($('tax').value)/100;
  if(!Number.isFinite(y)||!Number.isFinite(t)||y<0||y>1||t<0||t>1)throw Error('Yield and tax must be 0–100%.');
  if(!dataset){results=items.map(x=>({...x,action:'REVIEW',reason:'Automatic reprocessing dataset missing; no reliable recommendation possible.'}));render();$('status').textContent='Item import succeeded, but the EVE material dataset is not loaded.';return}
  for(let i=0;i<items.length;i++){
   const item=items[i];$('status').textContent=`Checking ${i+1}/${items.length}: ${item.name}`;await new Promise(resolve=>setTimeout(resolve,0));
   const def=dataset[item.name.toLowerCase()];if(!def){results.push({...item,action:'REVIEW',reason:'No verified one-unit reprocessing recipe for this item.'});render();continue}
   try{
    // A missing full-stack item buy order does not prevent valuation of recovered materials.
    const sell=await price(def.id,item.qty);let rep=0,failure=null;
    for(const[materialId,amount]of def.materials){
     if(!Number.isSafeInteger(amount)||amount<=0){failure='Invalid material quantity';break}
     const units=Math.floor(amount*item.qty*y*(1-t));if(units===0)continue;
     const materialValue=await price(materialId,units);
     if(materialValue===null){failure=`Insufficient Jita buy orders for material type ${materialId}`;break}
     rep+=materialValue;
    }
    if(failure){
     if(sell!==null)results.push({...item,sell,best:sell,action:'SELL',reason:`Reprocessing comparison unavailable: ${failure}`});
     else results.push({...item,action:'REVIEW',reason:`No full-stack item buy order; ${failure}`});
    }else if(sell===null)results.push({...item,sell:null,rep,best:rep,action:'REPROCESS'});
    else results.push({...item,sell,rep,best:Math.max(sell,rep),action:rep>sell?'REPROCESS':'SELL'});
   }catch(e){results.push({...item,action:'REVIEW',reason:'Market lookup failed: '+e.message})}
   render();
  }
  $('status').textContent=`Finished: ${results.filter(x=>x.action!=='REVIEW').length} valued, ${results.filter(x=>x.action==='REVIEW').length} need review.${bad.length?' Invalid inventory lines: '+bad.join(', '):''}`;
 }catch(e){$('status').textContent='Unable to calculate: '+e.message;render()}finally{btn.disabled=false}
}
function copyList(action){const list=results.filter(x=>x.action===action).sort(sort).map(x=>`${x.name}\t${x.qty}`).join('\n');navigator.clipboard.writeText(list).then(()=>$('status').textContent=`${action} list copied.`).catch(()=>$('status').textContent='Clipboard permission denied.')}
$('go').addEventListener('click',calculate);$('search').addEventListener('input',render);
$('copysell').addEventListener('click',()=>copyList('SELL'));$('copyrep').addEventListener('click',()=>copyList('REPROCESS'));
$('export').addEventListener('click',()=>{
 const q=s=>'"'+String(s??'').replaceAll('"','""')+'"';const lines=['Item,Quantity,Action,Sell ISK,Reprocess ISK,Best ISK,Reason'];
 for(const r of [...results].sort(sort))lines.push([q(r.name),r.qty,r.action,r.sell??'',r.rep??'',r.best??'',q(r.reason)].join(','));
 const url=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='eve-sell-reprocess.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
// Share links store inventory and settings in the URL fragment, not on a server.
// gzip compression keeps typical inventories shorter; no external library is required.
const SHARE_PREFIX = '#inventory=';
const SHARE_MAX_BYTES = 150000;
function bytesToBase64Url(bytes) {
 let out = '';
 for (let i=0;i<bytes.length;i+=8192) out += String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(out).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64UrlToBytes(encoded) {
 if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error('Invalid inventory link.');
 const raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-encoded.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function compressShare(input) {
 const raw=new TextEncoder().encode(input);
 if (!('CompressionStream' in window)) return 'p'+bytesToBase64Url(raw);
 const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
 return 'g'+bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function decompressShare(encoded) {
 const mode=encoded[0], bytes=base64UrlToBytes(encoded.slice(1));
 if(bytes.byteLength>SHARE_MAX_BYTES) throw Error('Shared inventory is too large.');
 if(mode==='p') return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(mode!=='g' || !('DecompressionStream' in window)) throw Error('This browser cannot open the compressed inventory link.');
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 // Read incrementally to cap decompressed size, including malicious links.
 const reader=stream.getReader(),chunks=[];let size=0;
 try {
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>SHARE_MAX_BYTES){await reader.cancel();throw Error('Shared inventory is too large.')}chunks.push(value)}
 }finally{reader.releaseLock()}
 const result=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}
 return new TextDecoder('utf-8',{fatal:true}).decode(result);
}
$('share').addEventListener('click',async()=>{
 try {
  const inventory=$('inventory').value;
  if(!inventory.trim()) throw Error('Paste your inventory before sharing.');
  const payload=JSON.stringify({v:1,inventory,yield:$('yield').value,tax:$('tax').value});
  if(new TextEncoder().encode(payload).length>SHARE_MAX_BYTES) throw Error('Inventory too large for a shareable link.');
  const fragment=SHARE_PREFIX+await compressShare(payload);
  const url=location.origin+location.pathname+location.search+fragment;
  if(url.length>12000) throw Error('This inventory makes a link too long to share reliably. Try a smaller selection.');
  await navigator.clipboard.writeText(url);
  $('status').textContent='Share link copied! Anyone with the link can view the inventory and automatically recalculate with current Jita prices.';
 }catch(e){$('status').textContent='Could not share inventory: '+e.message}
});
async function startCalculator(){
 // Wait for the recipe dataset before auto-calculating, so shared links work on first load.
 await loadData();
 if(!location.hash.startsWith(SHARE_PREFIX))return;
 try {
  const encoded=location.hash.slice(SHARE_PREFIX.length);
  const shared=JSON.parse(await decompressShare(encoded));
  if(shared.v!==1 || typeof shared.inventory!=='string' || !shared.inventory.trim()) throw Error('Invalid inventory data.');
  const y=Number(shared.yield),t=Number(shared.tax);
  if(!Number.isFinite(y)||!Number.isFinite(t)||y<0||y>100||t<0||t>100)throw Error('Invalid yield or tax.');
  $('inventory').value=shared.inventory;
  $('yield').value=String(y);$('tax').value=String(t);
  // Never execute content from the link; inventory is always handled as plain text.
  await calculate();
 }catch(e){$('status').textContent='Could not load shared inventory: '+e.message}
}
startCalculator();
