'use strict';
const $=id=>document.getElementById(id), STATION=60003760, REGION=10000002;
const isk=n=>Number(n).toLocaleString('en-GB',{maximumFractionDigits:0})+' ISK';
const sort=(a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'});
let dataset=null,results=[];
const ordersCache=new Map(),ammoCache=new Map();
// Identify ammunition using ESI type/group metadata, not a name substring.
async function isAmmo(typeId){
 if(ammoCache.has(typeId))return ammoCache.get(typeId);
 const job=(async()=>{
  const typeResponse=await fetch(`https://esi.evetech.net/latest/universe/types/${typeId}/`);
  if(!typeResponse.ok)throw Error(`Cannot identify item group (${typeResponse.status})`);
  const type=await typeResponse.json();
  const groupResponse=await fetch(`https://esi.evetech.net/latest/universe/groups/${type.group_id}/`);
  if(!groupResponse.ok)throw Error(`Cannot identify item group (${groupResponse.status})`);
  const group=await groupResponse.json();
  // Only charge groups with an ammunition-related group name qualify.
  return group.category_id===8 && /ammo|ammunition|missile|rocket|torpedo|bomb|hybrid charge|frequency crystal|advanced pulse laser crystal|advanced beam laser crystal|projectile|autocannon|artillery|blaster|railgun|citadel.*(cruise|torpedo)|defender/i.test(group.name||'');
 })();ammoCache.set(typeId,job);try{return await job}catch(e){ammoCache.delete(typeId);throw e}
}

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
const typeIdCache=new Map();
async function resolveTypeId(name){
 const key=name.toLowerCase();
 if(typeIdCache.has(key))return typeIdCache.get(key);
 const job=(async()=>{
  const response=await fetch('https://esi.evetech.net/latest/universe/ids/',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([name])
  });
  if(!response.ok)throw Error(`ESI item-name lookup failed (${response.status})`);
  const data=await response.json();
  const found=(data.inventory_types||[]).find(x=>x.name.toLowerCase()===key);
  if(!found)throw Error('Item name not found in EVE item database');
  return found.id;
 })();
 typeIdCache.set(key,job);
 try{return await job}catch(e){typeIdCache.delete(key);throw e}
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
 left.append(name);if(item.ammo&&item.action==='REPROCESS'){const detail=document.createElement('div');detail.className='hint note';detail.textContent=`Reprocess ${item.meltQty.toLocaleString('en-GB')} · Remaining ${item.remainder.toLocaleString('en-GB')} (sell)`;left.append(detail)}const right=document.createElement('span');right.className='number';right.textContent='×'+item.qty+(item.best==null?'':'  '+isk(item.best));d.append(left,right);wrap.append(d);
 if(item.reason){const note=document.createElement('div');note.className='hint bad';note.textContent=item.reason;wrap.append(note)}
 if(item.action==='REPROCESS'){
  const note=document.createElement('div');note.className='hint note';
  note.textContent=item.sell==null?`Sell: unavailable (insufficient Jita buy-order volume) · Melt: ${isk(item.meltValue)} · Leftovers: ${isk(item.leftoverValue||0)} · Difference: unknown`:`Sell all: ${isk(item.sell)} · Melt: ${isk(item.meltValue)} · Leftovers: ${isk(item.leftoverValue||0)} · Extra: ${isk(item.rep-item.sell)}`;
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
 const leftoverTotal=valued.filter(x=>x.action==='REPROCESS').reduce((s,x)=>s+(x.leftoverValue||0),0);
 const sellTotal=valued.filter(x=>x.action==='SELL').reduce((s,x)=>s+x.best,0)+leftoverTotal;
 const meltTotal=valued.filter(x=>x.action==='REPROCESS').reduce((s,x)=>s+x.meltValue,0);
 const meltVerified=results.filter(x=>x.meltValue!=null && x.meltValuationComplete===true);
 const meltMissing=results.filter(x=>x.meltValue==null || x.meltValuationComplete!==true);
 const allMeltKnown=results.length>0 && meltMissing.length===0;
 const allMeltTotal=meltVerified.reduce((s,x)=>s+x.meltValue,0);
 const reviewCount=results.length-valued.length;
 const summary=$('summary');summary.replaceChildren();
 const cards=[
  {label:'ISK made from selling (incl. leftovers)',value:isk(sellTotal),icon:'sell-icon.png'},
  {label:'ISK made from melting',value:isk(meltTotal),icon:'reprocess-icon.png'},
  {label:allMeltKnown?'Total ISK if everything was melted':'Verified partial all-melt ISK',value:meltVerified.length?isk(allMeltTotal):'Unavailable',icon:'reprocess-icon.png'},
  {label:'Total potential ISK',value:isk(total)},
  {label:'ISK made with calculator',value:isk(extra),kind:'gain'}
 ];
 const grid=document.createElement('div');grid.className='summary-grid';
 for(const {label,value,kind,icon} of cards){
  const card=document.createElement('div');card.className='summary-card';
  const title=document.createElement('div');title.className='summary-label'+(icon?' with-icon':'');
  if(icon){const img=document.createElement('img');img.src=icon;img.alt='';img.setAttribute('aria-hidden','true');title.append(img)}
  const titleText=document.createElement('span');titleText.textContent=label;title.append(titleText);
  const amount=document.createElement('div');amount.className='summary-value'+(kind?' '+kind:'');amount.textContent=value;
  card.append(title,amount);grid.append(card);
 }
 summary.append(grid);
 const meltNote=document.createElement('p');meltNote.className='hint note';
 meltNote.textContent=allMeltKnown?'All-melt total includes all verified recoverable materials, regardless of its SELL/REPROCESS recommendation. Items below their SDE minimum reprocessing batch contribute zero; leftover rounds are excluded.':`Full all-melt total unavailable: ${meltMissing.length} of ${results.length} item(s) lack verified melt values. ${meltVerified.length?'The figure above is a verified partial total, NOT the value of melting everything.':'No verified melting values are available.'} Missing: ${meltMissing.slice(0,8).map(x=>x.name).join(', ')}${meltMissing.length>8?', …':''}. Leftover units are excluded.`;
 summary.append(meltNote);
 if(reviewCount){const warning=document.createElement('p');warning.className='bad';warning.textContent=`⚠ ${reviewCount} item(s) could not be valued and are excluded from the totals. See the calculation status above; export CSV for item-specific reasons.`;summary.append(warning)}
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
   const def=dataset[item.name.toLowerCase()];
    if(!def){
     try{
      const typeId=await resolveTypeId(item.name);
      const sell=await price(typeId,item.qty);
      const reason='No verified reprocessing recipe available; melt comparison cannot be calculated.';
      if(sell!==null)results.push({...item,action:'SELL',sell,best:sell,meltValue:null,meltValuationComplete:false,reason});
      else results.push({...item,action:'REVIEW',sell:null,meltValue:null,meltValuationComplete:false,reason:reason+' Insufficient Jita 4-4 buy orders to sell the full quantity.'});
     }catch(e){results.push({...item,action:'REVIEW',meltValue:null,meltValuationComplete:false,reason:'Missing recipe; item/market lookup failed: '+e.message})}
     render();continue;
    }
   try{
    // A missing full-stack item buy order does not prevent valuation of recovered materials.
    const portion=Number(def.portionSize||1);
    if(!Number.isSafeInteger(portion)||portion<1)throw Error('Invalid SDE reprocessing portion size');
    const ammo=portion>1;
    const meltQty=Math.floor(item.qty/portion)*portion;
    const remainder=item.qty-meltQty;
    const sell=await price(def.id,item.qty);
    const leftoverValue=remainder?await price(def.id,remainder):0;
    let meltValue=0,failure=null;
    if(meltQty===0){
     if(sell!==null)results.push({...item,ammo,meltQty,remainder,meltValue:0,meltValuationComplete:true,sell,best:sell,action:'SELL',reason:`Fewer than ${portion} units required for a reprocessing batch; remaining ${remainder} must be sold.`});
     else results.push({...item,ammo,meltQty,remainder,meltValue:0,meltValuationComplete:true,action:'REVIEW',reason:'Below the minimum reprocessing batch and insufficient Jita buy orders to sell them.'});
     render();continue;
    }
    for(const[materialId,amount]of def.materials){
     if(!Number.isSafeInteger(amount)||amount<=0){failure='Invalid material quantity';break}
     const units=Math.floor(amount*(meltQty/portion)*y*(1-t));if(units===0)continue;
     const materialValue=await price(materialId,units);
     if(materialValue===null){failure=`Insufficient Jita buy orders for material type ${materialId}`;break}
     meltValue+=materialValue;
    }
    const meltValuationComplete=failure===null;
    if(remainder&&leftoverValue===null)failure=failure||'Insufficient Jita buy orders for remaining units';
    const rep=failure?null:meltValue+leftoverValue;
    const details={ammo,meltQty,remainder,meltValue,leftoverValue,meltValuationComplete};
    if(failure){
     if(sell!==null)results.push({...item,...details,sell,best:sell,action:'SELL',reason:`Reprocessing comparison unavailable: ${failure}`});
     else results.push({...item,action:'REVIEW',reason:`No full-stack item buy order; ${failure}`});
    }else if(sell===null)results.push({...item,...details,sell:null,rep,best:rep,action:'REPROCESS'});
    else results.push({...item,...details,sell,rep,best:Math.max(sell,rep),action:rep>sell?'REPROCESS':'SELL'});
   }catch(e){results.push({...item,action:'REVIEW',reason:'Market lookup failed: '+e.message})}
   render();
  }
  $('status').textContent=`Finished: ${results.filter(x=>x.action!=='REVIEW').length} valued, ${results.filter(x=>x.action==='REVIEW').length} need review.${bad.length?' Invalid inventory lines: '+bad.join(', '):''}`;
 }catch(e){$('status').textContent='Unable to calculate: '+e.message;render()}finally{btn.disabled=false}
}
function copyList(action){const list=results.filter(x=>x.action===action).sort(sort).map(x=>`${x.name}\t${action==='REPROCESS'?(x.meltQty??x.qty):x.qty}`).join('\n');navigator.clipboard.writeText(list).then(()=>$('status').textContent=`${action} list copied.`).catch(()=>$('status').textContent='Clipboard permission denied.')}
$('go').addEventListener('click',calculate);$('search').addEventListener('input',render);
$('copysell').addEventListener('click',()=>copyList('SELL'));$('copyrep').addEventListener('click',()=>copyList('REPROCESS'));
$('export').addEventListener('click',()=>{
 const q=s=>'"'+String(s??'').replaceAll('"','""')+'"';const lines=['Item,Quantity,Action,Sell ISK,Reprocess + Leftovers ISK,Best ISK,Reprocess Quantity,Remaining Quantity,Reason'];
 for(const r of [...results].sort(sort))lines.push([q(r.name),r.qty,r.action,r.sell??'',r.rep??'',r.best??'',r.meltQty??'',r.remainder??'',q(r.reason)].join(','));
 const url=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='eve-sell-reprocess.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});loadData();
