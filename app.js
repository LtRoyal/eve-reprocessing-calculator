'use strict';
const $=id=>document.getElementById(id), STATION=60003760, REGION=10000002;
const isk=n=>Number(n).toLocaleString('en-GB',{maximumFractionDigits:0})+' ISK';
const sort=(a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'});
let dataset=null,results=[];
const ordersCache=new Map(),ammoCache=new Map();
let breakdownVersion=0,breakdownLoaded=-1;
const materialNameCache=new Map();
// ESI Date/HTTP Age describe the response, not a guaranteed market-price snapshot.
const marketInfo={lastFetched:null,esiDate:null,ageSeconds:null,requests:0,reused:0,recipeGenerated:null};
function marketTime(date){if(!date)return 'Not yet retrieved';const d=new Date(date);if(Number.isNaN(d.getTime()))return 'Unknown';return d.toLocaleString('en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'});}
function updateMarketInfo(){
 let el=$('marketDataInfo');
 if(!el){el=document.createElement('p');el.id='marketDataInfo';el.className='hint note';el.style.cssText='line-height:1.6;margin:10px 0;white-space:pre-line';$('dataStatus').insertAdjacentElement('afterend',el)}
 const cache=marketInfo.requests?`${marketInfo.requests} market API request(s); ${marketInfo.reused} cached result(s) reused in this calculation.`:'No market orders requested yet.';
 el.textContent=`Market source: Fenris Creations (formerly CCP Games) EVE ESI — The Forge, Jita 4-4 station buy orders.\nLast market request: ${marketTime(marketInfo.lastFetched)}.\nReprocessing recipe file generated: ${marketInfo.recipeGenerated||'Unknown'}.\n${cache} Retrieval time is not the time Fenris Creations last changed prices; ESI data may be cached.`;
}
updateMarketInfo();
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
   // Clipboard exports may contain a name followed by empty tab columns.
   // A missing quantity means one item, not an invalid inventory line.
   const nonempty=parts.filter(Boolean);
   const numeric=value=>/^\d[\d,]*$/.test(value);
   if(nonempty.length===1){name=nonempty[0]}
   else if(numeric(nonempty[1])){name=nonempty[0];qty=Number(nonempty[1].replaceAll(',',''))}
   else if(numeric(nonempty[0])){name=nonempty[1];qty=Number(nonempty[0].replaceAll(',',''))}
   else{bad.push(i+1);return}
  }else{
   const m=line.trim().match(/^(.*?)\s{2,}(\d[\d,]*)(?:\s{2,}.*)?$/);
   if(m){name=m[1].trim();qty=Number(m[2].replaceAll(',',''))}
   else{
    name=line.trim();
    // Single-space quantities are accepted only for a verified item name.
    // This avoids misreading legitimate EVE item names ending in numbers.
    const trailing=name.match(/^(.*?)\s+(\d[\d,]*)$/);
    if(trailing && dataset && Object.prototype.hasOwnProperty.call(dataset,trailing[1].trim().toLowerCase())){
     name=trailing[1].trim();qty=Number(trailing[2].replaceAll(',',''));
    }
   }
  }
  if(!name||!Number.isSafeInteger(qty)||qty<1){bad.push(i+1);return}
  const key=name.toLowerCase(),old=map.get(key);
  map.set(key,{name:old?.name||name,qty:(old?.qty||0)+qty});
 });return{items:[...map.values()].sort(sort),bad};
}
async function loadData(){
 try{const r=await fetch('./eve-data.json',{cache:'no-cache'});if(!r.ok)throw Error(`HTTP ${r.status}`);
  const data=await r.json();if(!data.items||Object.keys(data.items).length<1000)throw Error('Incomplete dataset');
  dataset=data.items;marketInfo.recipeGenerated=data.generated||null;updateMarketInfo();$('dataStatus').textContent=`✓ Automatic EVE material data loaded (${Object.keys(dataset).length.toLocaleString()} recipes; ${data.generated?.slice(0,10)||'date unknown'}).`;
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
 if(ordersCache.has(typeId)){marketInfo.reused++;updateMarketInfo();return ordersCache.get(typeId);}
 const job=(async()=>{let all=[];
  for(let page=1;page<=100;page++){
   const url=`https://esi.evetech.net/latest/markets/${REGION}/orders/?order_type=buy&type_id=${typeId}&page=${page}`;
   const response=await fetch(url);marketInfo.lastFetched=new Date().toISOString();marketInfo.requests++;
    const dateHeader=response.headers.get('date'),ageHeader=response.headers.get('age');
    if(dateHeader&&!Number.isNaN(Date.parse(dateHeader)))marketInfo.esiDate=dateHeader;
    if(ageHeader!==null&&Number.isFinite(Number(ageHeader)))marketInfo.ageSeconds=Number(ageHeader);
    updateMarketInfo();if(!response.ok)throw Error(`ESI error ${response.status} for type ${typeId}`);
   const data=await response.json();if(!Array.isArray(data))throw Error('Unexpected ESI response');
   all.push(...data.filter(o=>o.location_id===STATION&&o.is_buy_order===true&&o.volume_remain>0));
   const pages=Number(response.headers.get('x-pages')||1);if(page>=pages)break;
   if(page===100)throw Error('Too many market pages; cannot verify full buy-order depth');
  }return all.sort((a,b)=>b.price-a.price);
 })();ordersCache.set(typeId,job);try{return await job}catch(e){ordersCache.delete(typeId);throw e}
}
function fillValue(orders,qty){let left=qty,total=0;for(const o of orders){if(left<=0)break;const take=Math.min(left,o.volume_remain);total+=take*o.price;left-=take}return left===0?total:null}
async function price(typeId,qty){return fillValue(await getOrders(typeId),qty)}
async function buyOrderStatus(typeId,qty){const orders=await getOrders(typeId);const available=orders.reduce((sum,o)=>sum+o.volume_remain,0);return available===0?'No Jita 4-4 buy orders available':`Insufficient Jita 4-4 buy-order volume (${available.toLocaleString('en-GB')} available for ${qty.toLocaleString('en-GB')} units)`;}
function makeRow(item){
 const wrap=document.createElement('div'),d=document.createElement('div');d.className='item';
 const left=document.createElement('div');
 const name=document.createElement('button');name.textContent=item.name;name.title='Copy item name';
 name.onclick=async()=>{try{await navigator.clipboard.writeText(item.name);name.textContent='✓ Copied: '+item.name;setTimeout(()=>name.textContent=item.name,1200)}catch(e){$('status').textContent='Clipboard permission denied. Please allow clipboard access.'}};
 const label=document.createElement('span');label.className='item-label';
 const quantity=document.createElement('span');quantity.className='item-quantity';quantity.textContent='×'+item.qty.toLocaleString('en-GB');
 label.append(name,quantity);left.append(label);
 if(item.ammo&&item.action==='REPROCESS'){const detail=document.createElement('div');detail.className='hint note';detail.textContent=`Reprocess ${item.meltQty.toLocaleString('en-GB')} · Remaining ${item.remainder.toLocaleString('en-GB')} (sell)`;left.append(detail)}
 const right=document.createElement('span');right.className='number';right.textContent=item.best==null?'':isk(item.best);d.append(left,right);wrap.append(d);
 if(item.action==='NO_BUY'){const note=document.createElement('div');note.className='hint note';note.textContent=item.buyStatus||'No valid buy orders for the full quantity';wrap.append(note);if(item.meltValuationComplete&&item.meltValue!=null){const value=document.createElement('div');value.className='hint note';value.textContent=`Potential reprocessing value: ${isk(item.meltValue)} (not a verified gain over selling)`;wrap.append(value)}}
 if(item.sellOnly){const note=document.createElement('div');note.className='hint note';note.textContent='No reprocessing recipe available; better to sell to buy orders';wrap.append(note)}
 if(item.reason){const note=document.createElement('div');note.className='hint bad';note.textContent=item.reason;wrap.append(note)}
 if(item.action==='SELL' && !item.sellOnly){
  const note=document.createElement('div');note.className='hint note';
  if(item.meltValuationComplete===true && item.meltValue!=null && item.leftoverValue!=null && item.sell!=null){
   note.textContent=`Sell all: ${isk(item.sell)} · Melt: ${isk(item.meltValue)}`;
  }else{
   note.textContent=`Sell all: ${isk(item.sell)} · Melt: unavailable (comparison could not be verified)`;
  }
  wrap.append(note);
 }
 if(item.action==='REPROCESS'){
  const note=document.createElement('div');note.className='hint note';
  note.textContent=item.sell==null?`Sell: unavailable (insufficient Jita buy-order volume) · Melt: ${isk(item.meltValue)} · Leftovers: ${isk(item.leftoverValue||0)} · Difference: unknown`:`Sell all: ${isk(item.sell)} · Melt: ${isk(item.meltValue)} · Leftovers: ${isk(item.leftoverValue||0)} · Extra: ${isk(item.rep-item.sell)}`;
  wrap.append(note);
 }return wrap;
}
function render(){
 const query=$('search').value.trim().toLocaleLowerCase();
 for(const [id,action] of [['sell','SELL'],['rep','REPROCESS'],['nobuy','NO_BUY']]){
  const all=results.filter(x=>x.action===action).sort(sort),list=all.filter(x=>x.name.toLocaleLowerCase().includes(query)),el=$(id);el.replaceChildren();
  if(!list.length)el.textContent=all.length?'No matching items':'No items';else list.forEach(x=>el.append(makeRow(x)));
  const countId=action==='SELL'?'sellcount':action==='REPROCESS'?'repcount':'nobuycount';
  $(countId).textContent=`(${all.length}${query?' · '+list.length+' shown':''})`;
 }
 const valued=results.filter(x=>x.action==='SELL'||x.action==='REPROCESS');
 const comparable=valued.filter(x=>x.sell!=null);
 const total=comparable.reduce((s,x)=>s+x.sell,0); // All-sold scenario: direct Jita buy-order proceeds, never recommended melt values.
 const extra=comparable.reduce((s,x)=>s+x.best-x.sell,0);
 const leftoverTotal=valued.filter(x=>x.action==='REPROCESS').reduce((s,x)=>s+(x.leftoverValue||0),0);
 const sellTotal=valued.filter(x=>x.action==='SELL').reduce((s,x)=>s+x.best,0)+leftoverTotal;
 const meltTotal=valued.filter(x=>x.action==='REPROCESS').reduce((s,x)=>s+x.meltValue,0);
 const meltVerified=results.filter(x=>x.meltValue!=null && x.meltValuationComplete===true);
 const sellOnlyCount=results.filter(x=>x.sellOnly).length;
 const meltMissing=results.filter(x=>!x.sellOnly && (x.meltValue==null || x.meltValuationComplete!==true));
 const allMeltKnown=results.length>0 && meltMissing.length===0;
 const allMeltTotal=meltVerified.reduce((s,x)=>s+x.meltValue,0);
 const reviewCount=results.filter(x=>x.action==='REVIEW').length;
 const noBuyCount=results.filter(x=>x.action==='NO_BUY').length;
  $('noBuyPanel').hidden=noBuyCount===0;
 const summary=$('summary');summary.replaceChildren();
 const cards=[
  {label:'ISK made from selling (incl. leftovers)',value:isk(sellTotal),icon:'sell-icon.png'},
  {label:'ISK made from melting',value:isk(meltTotal),icon:'reprocess-icon.png'},
  {label:allMeltKnown?(sellOnlyCount?'Total ISK if all meltable items were melted':'Total ISK if everything was melted'):'Verified partial all-melt ISK',value:meltVerified.length?isk(allMeltTotal):'Unavailable',icon:'reprocess-icon.png'},
  {label:'Total potential ISK if everything was sold',value:isk(total),icon:'sell-icon.png'},
  {label:'Extra ISK made using Every Little Bit',value:isk(extra),kind:'gain'}
 ];
 const grid=document.createElement('div');grid.className='summary-grid';
 for(const {label,value,kind,icon} of cards){
  const card=document.createElement('div');card.className='summary-card';
  const title=document.createElement('div');title.className='summary-label'+(icon?' with-icon':'');
  if(icon){const img=document.createElement('img');img.src=icon;img.alt='';img.setAttribute('aria-hidden','true');title.append(img)}
  const headingText=kind==='gain'?'BONUS':label==='ISK made from selling (incl. leftovers)'?'Better to SELL':label==='ISK made from melting'?'Better to REPROCESS':null;
  if(headingText){
   const heading=document.createElement('span');heading.className='summary-card-heading '+(kind==='gain'?'bonus-heading':label.includes('selling')?'sell-heading':'reprocess-heading');heading.textContent=headingText;title.append(heading);
   const subtitle=document.createElement('span');subtitle.className='summary-card-subtitle';subtitle.textContent=label;title.append(subtitle);
  }else{const titleText=document.createElement('span');titleText.textContent=label;title.append(titleText);}
  const amount=document.createElement('div');amount.className='summary-value'+(kind?' '+kind:'');amount.textContent=value;
  card.append(title,amount);grid.append(card);
 }
 summary.append(grid);
 const meltNote=document.createElement('p');meltNote.className='hint note';
 meltNote.textContent=allMeltKnown?`All-melt total includes verified recoverable materials. ${sellOnlyCount?sellOnlyCount+' item(s) have no recipe in the current data and are treated as sell-only; their sell value is excluded from the all-melt total. ':''}Items below their minimum reprocessing batch contribute zero; leftovers are excluded.`:`Full all-melt total unavailable: ${meltMissing.length} of ${results.length} item(s) lack verified melt values. ${meltVerified.length?'The figure above is a verified partial total, NOT the value of melting everything.':'No verified melting values are available.'} Missing: ${meltMissing.slice(0,8).map(x=>x.name).join(', ')}${meltMissing.length>8?', …':''}. Leftover units are excluded.`;
 summary.append(meltNote);
 if(noBuyCount){const note=document.createElement('p');note.className='hint note';note.textContent=`${noBuyCount} item(s) lack sufficient Jita 4-4 buy orders and are excluded from verified selling comparisons and total potential ISK. Any displayed melt values are informational only.`;summary.append(note)}
 if(reviewCount){const warning=document.createElement('p');warning.className='bad';warning.textContent=`⚠ ${reviewCount} item(s) could not be valued and are excluded from the totals. See the calculation status above; export CSV for item-specific reasons.`;summary.append(warning)}
 $('export').disabled=!results.length;$('copysell').disabled=!results.some(x=>x.action==='SELL');$('copyrep').disabled=!results.some(x=>x.action==='REPROCESS');
}
// Lightweight, accessible calculation progress indicator. No pricing logic is changed.
function ensureCalculationProgress(){
 let panel=$('elb-progress');if(panel)return panel;
 const style=document.createElement('style');style.textContent=`
 #elb-progress{margin:12px 0;padding:15px 17px;border:1px solid #b98536;border-radius:12px;background:#192437;color:#e9edf5}
 #elb-progress[hidden]{display:none!important}
 #elb-progress .elb-progress-title{font-weight:700;color:#ffb45e;margin-bottom:6px}
 #elb-progress .elb-progress-description{font-size:.92em;line-height:1.5;color:#c5d1e1;margin-bottom:12px}
 #elb-progress .elb-progress-track{height:11px;border-radius:99px;background:#354154;overflow:hidden}
 #elb-progress .elb-progress-fill{height:100%;width:0%;background:linear-gradient(90deg,#c48729,#ffd078);border-radius:99px;transition:width .2s ease}
 #elb-progress .elb-progress-count{margin-top:8px;text-align:right;font-variant-numeric:tabular-nums;font-size:.86em;color:#c5d1e1}
 #elb-nobuy-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
 #noBuyPanel h2{font-size:1.25rem;line-height:1.35}
 #elb-nobuy-toggle .elb-chevron{display:inline-block;width:9px;height:9px;flex:none;margin-right:4px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .15s ease}
 #elb-nobuy-toggle[aria-expanded=true] .elb-chevron{transform:rotate(225deg)}
 #elb-nobuy-toggle:focus-visible{outline:2px solid #ffb45e;outline-offset:5px;border-radius:4px}
 `;document.head.append(style);
 panel=document.createElement('div');panel.id='elb-progress';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label','Calculation progress');
 panel.innerHTML='<div class="elb-progress-title">Calculating your loot’s value…</div><div class="elb-progress-description">Every Little Bit is checking Jita 4-4 buy orders and reprocessing values to help you get the most ISK from your loot. Larger inventories may take a little longer to process.</div><div class="elb-progress-track" role="progressbar" aria-label="Items checked" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="elb-progress-fill"></div></div><div class="elb-progress-count">0 / 0 items checked</div>';
 $('status').insertAdjacentElement('beforebegin',panel);return panel;
}
function setCalculationProgress(done,total){
 const panel=ensureCalculationProgress();panel.hidden=false;
 const percent=total?Math.round(100*done/total):0;
 panel.querySelector('.elb-progress-fill').style.width=percent+'%';
 const track=panel.querySelector('[role="progressbar"]');track.setAttribute('aria-valuenow',String(percent));
 panel.querySelector('.elb-progress-count').textContent=`${done.toLocaleString('en-GB')} / ${total.toLocaleString('en-GB')} items checked`;
}
function hideCalculationProgress(){const panel=$('elb-progress');if(panel)panel.hidden=true;}
function ensureNoBuyToggle(){
 const panel=$('noBuyPanel');if(!panel||panel.querySelector('#elb-nobuy-toggle'))return;
 const heading=panel.querySelector('h2');if(!heading)return;
 const content=document.createElement('div');content.id='elb-nobuy-content';
 while(heading.nextSibling)content.append(heading.nextSibling);
 panel.append(content);
 const button=document.createElement('button');button.type='button';button.id='elb-nobuy-toggle';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',content.id);
 while(heading.firstChild)button.append(heading.firstChild);
 const chevron=document.createElement('span');chevron.className='elb-chevron';chevron.textContent='';chevron.setAttribute('aria-hidden','true');button.append(chevron);
 heading.append(button);content.hidden=true;
 button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));content.hidden=!open;});
}
ensureNoBuyToggle();
async function calculate(){
 const btn=$('go');if(btn.disabled)return;btn.disabled=true;hideCalculationProgress();clearSnapshotAddress();results=[];breakdownVersion++;breakdownLoaded=-1;resetBreakdown();marketInfo.requests=0;marketInfo.reused=0;updateMarketInfo();
 try{
  const{items,bad}=parseInventory($('inventory').value);if(!items.length)throw Error('Paste valid EVE item rows first.');
  const y=Number($('yield').value)/100,t=Number($('tax').value)/100;
  if(!Number.isFinite(y)||!Number.isFinite(t)||y<0||y>1||t<0||t>1)throw Error('Yield and tax must be 0–100%.');
  setCalculationProgress(0,items.length);
  if(!dataset){results=items.map(x=>({...x,action:'REVIEW',reason:'Automatic reprocessing dataset missing; no reliable recommendation possible.'}));render();$('status').textContent='Item import succeeded, but the EVE material dataset is not loaded.';return}
  for(let i=0;i<items.length;i++){
   const item=items[i];$('status').textContent=`Checking ${i+1}/${items.length}: ${item.name}`;
   // Refresh the results in batches rather than rebuilding the entire UI per item.
   const refreshProgress=()=>{setCalculationProgress(i+1,items.length);if((i+1)%8===0||i===items.length-1)render();};
   const def=dataset[item.name.toLowerCase()];
    if(!def){
     try{
      const typeId=await resolveTypeId(item.name);
      const sell=await price(typeId,item.qty);
      if(sell!==null)results.push({...item,action:'SELL',sell,best:sell,sellOnly:true,meltValue:null,meltValuationComplete:false});
      else results.push({...item,action:'NO_BUY',sell:null,sellOnly:true,buyStatus:await buyOrderStatus(typeId,item.qty),meltValue:null,meltValuationComplete:false});
     }catch(e){results.push({...item,action:'REVIEW',meltValue:null,meltValuationComplete:false,reason:'Missing recipe; item/market lookup failed: '+e.message})}
     refreshProgress();continue;
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
    const recoveredMaterials=[];
    if(meltQty===0){
     if(sell!==null)results.push({...item,ammo,meltQty,remainder,meltValue:0,meltValuationComplete:true,sell,best:sell,action:'SELL',reason:`Fewer than ${portion} units required for a reprocessing batch; remaining ${remainder} must be sold.`});
     else results.push({...item,ammo,meltQty,remainder,meltValue:0,meltValuationComplete:true,action:'NO_BUY',buyStatus:await buyOrderStatus(def.id,item.qty)});
     refreshProgress();continue;
    }
    // Build the recipe first; independent material market lookups can run together.
    // Preserve recipe order when applying values and reporting the first failure.
    for(const[materialId,amount]of def.materials){
     if(!Number.isSafeInteger(amount)||amount<=0){failure='Invalid material quantity';break}
     const units=Math.floor(amount*(meltQty/portion)*y*(1-t));if(units===0)continue;
     recoveredMaterials.push({id:materialId,qty:units});
    }
    if(!failure){
     const materialValues=await Promise.all(recoveredMaterials.map(m=>price(m.id,m.qty).then(value=>({value}),error=>({error}))));
     for(let j=0;j<recoveredMaterials.length;j++){
      const outcome=materialValues[j];
      if(outcome.error)throw outcome.error;
      if(outcome.value===null){failure=`Insufficient Jita buy orders for material type ${recoveredMaterials[j].id}`;break}
      meltValue+=outcome.value;
     }
    }
    const meltValuationComplete=failure===null;
    if(remainder&&leftoverValue===null)failure=failure||'Insufficient Jita buy orders for remaining units';
    const rep=failure?null:meltValue+leftoverValue;
    const details={ammo,meltQty,remainder,meltValue,leftoverValue,meltValuationComplete,recoveredMaterials};
    if(failure){
     if(sell!==null)results.push({...item,...details,sell,best:sell,action:'SELL',reason:`Reprocessing comparison unavailable: ${failure}`});
     else results.push({...item,...details,action:'NO_BUY',sell:null,buyStatus:await buyOrderStatus(def.id,item.qty),reason:`Reprocessing valuation incomplete: ${failure}`});
    }else if(sell===null)results.push({...item,...details,sell:null,rep,action:'NO_BUY',buyStatus:await buyOrderStatus(def.id,item.qty)});
    else results.push({...item,...details,sell,rep,best:Math.max(sell,rep),action:rep>sell?'REPROCESS':'SELL'});
   }catch(e){results.push({...item,action:'REVIEW',reason:'Market lookup failed: '+e.message})}
   refreshProgress();
  }
  $('status').textContent=`Finished: ${results.filter(x=>x.action!=='REVIEW').length} valued, ${results.filter(x=>x.action==='NO_BUY').length} without sufficient buy orders, ${results.filter(x=>x.action==='REVIEW').length} need review.${bad.length?' Invalid inventory lines: '+bad.join(', '):''}`;
   trackCompletedCalculation();
  await createShareSnapshot({automatic:true});
 }catch(e){$('status').textContent='Unable to calculate: '+e.message;render()}finally{btn.disabled=false;hideCalculationProgress()}
}

// The expandable material table is informational and never changes recommendations.
function resetBreakdown(){
 const body=$('breakdown-body');if(body)body.replaceChildren();
 const status=$('breakdown-status');if(status)status.textContent='Expand to view the combined materials from recommended REPROCESS items.';
}
async function materialName(typeId){
 if(materialNameCache.has(typeId))return materialNameCache.get(typeId);
 const job=(async()=>{
  const response=await fetch(`https://esi.evetech.net/latest/universe/types/${typeId}/`);
  if(!response.ok)throw Error(`ESI name lookup ${response.status}`);
  const data=await response.json();return data.name||`Material type ${typeId}`;
 })();materialNameCache.set(typeId,job);
 try{return await job}catch(e){materialNameCache.delete(typeId);return `Material type ${typeId}`}
}
async function showBreakdown(){
 const version=breakdownVersion;
 if(breakdownLoaded===version)return;
 const body=$('breakdown-body'),status=$('breakdown-status');
 body.replaceChildren();status.textContent='Loading recovered materials and Jita buy-order values…';
 const materials=new Map();
 for(const item of results.filter(x=>x.action==='REPROCESS')){
  for(const m of item.recoveredMaterials||[]){materials.set(m.id,(materials.get(m.id)||0)+m.qty)}
 }
 if(!materials.size){status.textContent='No items are currently recommended for REPROCESS.';breakdownLoaded=version;return}
 const entries=[];
 for(const [id,qty] of materials){
  try{
   const [name,value]=await Promise.all([materialName(id),price(id,qty)]);
   if(version!==breakdownVersion||!$('breakdown-details').open)return;
   entries.push({name,qty,value,reason:value===null?'Insufficient Jita 4-4 buy-order volume':null});
  }catch(e){
   if(version!==breakdownVersion||!$('breakdown-details').open)return;
   entries.push({name:await materialName(id),qty,value:null,reason:'Market lookup failed: '+e.message});
  }
 }
 if(version!==breakdownVersion||!$('breakdown-details').open)return;
 entries.sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));
 if(version!==breakdownVersion||!$('breakdown-details').open)return;
 const table=document.createElement('table');table.className='breakdown-table';
 const head=document.createElement('thead'),header=document.createElement('tr');
 for(const title of ['Material','Quantity','Jita buy value']){const th=document.createElement('th');th.textContent=title;header.append(th)}
 head.append(header);table.append(head);
 const tbody=document.createElement('tbody');
 for(const entry of entries){
  const tr=document.createElement('tr');
  for(const value of [entry.name,entry.qty.toLocaleString('en-GB'),entry.value===null?'Unavailable':isk(entry.value)]){
   const td=document.createElement('td');td.textContent=value;tr.append(td)
  }
  if(entry.reason){tr.title=entry.reason;tr.className='breakdown-unavailable'}
  tbody.append(tr);
 }
 table.append(tbody);
 const missing=entries.filter(x=>x.value===null).length;
 const sum=entries.reduce((total,x)=>total+(x.value||0),0);
 const total=document.createElement('div');total.className='breakdown-total';
 total.textContent=(missing?'Verified partial material value: ':'Total material buy-order value: ')+isk(sum);

 const note=document.createElement('p');note.className='hint note';
 note.textContent='Combined quantities are valued against Jita 4-4 buy-order depth. This informational total can differ from the Summary, which values items individually. Leftover unreprocessed units are excluded.';
 body.replaceChildren(table,total,note);
 status.textContent=missing?`${entries.length} material types · ${missing} unavailable; total is partial.`:`${entries.length} material types · all combined quantities valued.`;
 breakdownLoaded=version;
}
$('breakdown-details').addEventListener('toggle',()=>{
 if($('breakdown-details').open)showBreakdown();
});

function copyList(action){const list=results.filter(x=>x.action===action).sort(sort).map(x=>`${x.name}\t${action==='REPROCESS'?(x.meltQty??x.qty):x.qty}`).join('\n');navigator.clipboard.writeText(list).then(()=>$('status').textContent=`${action} list copied.`).catch(()=>$('status').textContent='Clipboard permission denied.')}
$('start-fresh').addEventListener('click',()=>{
  trackUsage('start_fresh');
 $('inventory').value='';$('yield').value='55';$('tax').value='0';
 // Navigate to the clean page without the frozen snapshot ID or legacy fragment.
 location.replace(location.origin+location.pathname);
});
$('go').addEventListener('click',calculate);$('search').addEventListener('input',render);
$('copysell').addEventListener('click',()=>copyList('SELL'));$('copyrep').addEventListener('click',()=>copyList('REPROCESS'));
$('export').addEventListener('click',()=>{
 const q=s=>'"'+String(s??'').replaceAll('"','""')+'"';const lines=['Item,Quantity,Action,Sell ISK,Reprocess + Leftovers ISK,Best ISK,Reprocess Quantity,Remaining Quantity,Reason'];
 for(const r of [...results].sort(sort))lines.push([q(r.name),r.qty,r.action,r.sell??'',r.rep??'',r.best??'',r.meltQty??'',r.remainder??'',q(r.reason||r.buyStatus)].join(','));
 const url=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='eve-sell-reprocess.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  trackUsage('csv_export');
});loadData();


// Short frozen snapshots are stored in Cloudflare KV by the public Worker.
// Legacy self-contained snapshot URLs remain readable for older shared links.
// Remove incoming marketing/tracking parameters from the visible address bar.
// Preserve functional snapshot IDs, other query parameters and legacy snapshot fragments.
(function cleanTrackingParameters(){
 try{
  const url=new URL(location.href);
  let changed=false;
  for(const key of [...url.searchParams.keys()]){
   if(/^utm_/i.test(key)||/^(fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid)$/i.test(key)){
    url.searchParams.delete(key);changed=true;
   }
  }
  if(changed)history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 }catch(e){/* URL cleanup should never interfere with the calculator. */}
})();
const SNAPSHOT_API='https://dry-lake-db71every-little-bit-snapshots.armarlio2nd.workers.dev';
const snapshotPrefix='elb-snapshot-v1=';
// Anonymous private usage analytics: only event names and rounded ISK totals.
// Values are sent in millions of ISK, not as exact ISK amounts.
function trackUsage(type, fields={}){
 try{
  const payload=JSON.stringify({type,...fields});
  fetch(SNAPSHOT_API+'/analytics',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:payload,keepalive:true
  }).catch(()=>{}); // Analytics failures must never affect the calculator.
 }catch(e){/* Optional telemetry only. */}
}
function roundedIskMillions(value){
 return Number.isFinite(value)&&value>=0?Math.round(value/1_000_000):0;
}
function trackCompletedCalculation(){
 if(!results.length)return;
 const valued=results.filter(x=>x.action==='SELL'||x.action==='REPROCESS');
 const comparable=valued.filter(x=>Number.isFinite(x.sell)&&Number.isFinite(x.best));
 const sell=comparable.reduce((sum,x)=>sum+x.sell,0);
 const recommended=comparable.reduce((sum,x)=>sum+x.best,0);
 const extra=Math.max(0,recommended-sell);
 const sellComponent=valued.filter(x=>x.action==='SELL').reduce((sum,x)=>sum+(Number.isFinite(x.best)?x.best:0),0)
  +valued.filter(x=>x.action==='REPROCESS').reduce((sum,x)=>sum+(Number.isFinite(x.leftoverValue)?x.leftoverValue:0),0);
 const meltComponent=valued.filter(x=>x.action==='REPROCESS').reduce((sum,x)=>sum+(Number.isFinite(x.meltValue)?x.meltValue:0),0);
 trackUsage('calculation_completed',{
  sell_isk_m:roundedIskMillions(sell),
  recommended_isk_m:roundedIskMillions(recommended),
  extra_isk_m:roundedIskMillions(extra),
  sell_component_isk_m:roundedIskMillions(sellComponent),
  melt_component_isk_m:roundedIskMillions(meltComponent),
  item_count:results.length,
  valued_count:comparable.length,
  unavailable_count:results.length-comparable.length
 });
}

function base64urlToBytes(value){
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function decodeSnapshot(payload){
 const bytes=base64urlToBytes(payload.slice(1));let decoded=bytes;
 if(payload[0]==='g'){
  if(typeof DecompressionStream==='undefined')throw Error('This browser cannot decompress older snapshot links.');
  decoded=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 }else if(payload[0]!=='p')throw Error('Unknown snapshot encoding');
 return JSON.parse(new TextDecoder().decode(decoded));
}
async function snapshotResponseError(response){
 let message=`HTTP ${response.status}`;
 try{const data=await response.json();if(data.error)message=data.error;}catch(e){}
 if(response.status===413)message+=' — this inventory exceeds the snapshot storage limit configured in Cloudflare.';
 return new Error(message);
}
function snapshotMessage(message){const el=$('share-status');el.hidden=false;el.textContent=message;}
function snapshotNotice(when){
 let el=$('snapshot-notice');if(!el){el=document.createElement('div');el.id='snapshot-notice';el.className='snapshot-notice';
 const inventory=$('inventory').closest('.panel');inventory.parentNode.insertBefore(el,inventory);}
 el.textContent=`FROZEN RESULTS SNAPSHOT · Created ${new Date(when).toLocaleString('en-GB')}. Prices and recommendations are saved from the original calculation; they are not refreshed. Click Calculate to recalculate with current market data.`;
}
function clearSnapshotAddress(){
 const url=new URL(location.href);
 if(url.searchParams.has('s')||url.hash.startsWith('#'+snapshotPrefix)){
  url.searchParams.delete('s');if(url.hash.startsWith('#'+snapshotPrefix))url.hash='';
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 }
 const input=$('snapshot-link');if(input)input.remove();
}
async function createShareSnapshot({automatic=false}={}){
 if(!results.length){snapshotMessage('Run a calculation before sharing a results snapshot.');return}
 snapshotMessage(automatic?'Calculation finished. Creating shareable address…':'Saving frozen snapshot to Cloudflare…');
 try{
  const details=$('breakdown-details');const wasOpen=details.open;details.open=true;
  try{await showBreakdown()}finally{if(automatic)details.open=wasOpen}
  if(breakdownLoaded!==breakdownVersion)throw Error('The material breakdown could not finish loading. Please try again.');
  const data={v:1,created:new Date().toISOString(),inventory:$('inventory').value,
   yield:$('yield').value,tax:$('tax').value,results,
   status:$('status').textContent,breakdownStatus:$('breakdown-status').textContent,
   breakdownHTML:$('breakdown-body').innerHTML,
   recipeGenerated:marketInfo.recipeGenerated,marketFetched:marketInfo.lastFetched};
  const response=await fetch(SNAPSHOT_API+'/snapshots',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
  });
  if(!response.ok)throw await snapshotResponseError(response);
  const saved=await response.json();
  if(!/^[a-f0-9]{24}$/.test(saved.id||''))throw Error('Snapshot service returned an invalid ID.');
  const url=new URL(location.pathname,location.origin);url.searchParams.set('s',saved.id);
  const link=url.href;
  history.replaceState(history.state,'',url.pathname+url.search);
  if(automatic){snapshotMessage('Shareable snapshot link added to the address bar! Copy the browser address to share these frozen results. Expires in 7 days.')}
  else try{await navigator.clipboard.writeText(link);
   snapshotMessage('Short frozen snapshot link copied! It expires in 7 days. Anyone with the link can see the inventory and saved results.');
  }catch(e){snapshotMessage('Snapshot saved! Copy the link from your browser address bar.');}
 }catch(e){snapshotMessage((automatic?'Calculation completed, but automatic sharing failed: ':'Unable to save snapshot: ')+e.message)}
}
function applyShareSnapshot(data){
 hideCalculationProgress();
 if(data.v!==1||!Array.isArray(data.results)||typeof data.inventory!=='string'||!data.created)throw Error('Invalid snapshot format');
  $('inventory').value=data.inventory;$('yield').value=data.yield;$('tax').value=data.tax;
  results=data.results;render();$('status').textContent=data.status||'Frozen calculation restored.';
  breakdownVersion++;breakdownLoaded=breakdownVersion;
  // The HTML originates from our own generated table; sanitize by reconstructing text-only table nodes.
  const source=new DOMParser().parseFromString(data.breakdownHTML||'','text/html');
  const target=$('breakdown-body');target.replaceChildren();
  const table=source.querySelector('table');
  if(table){const clean=document.createElement('table');clean.className='breakdown-table';
   for(const row of table.querySelectorAll('tr')){const tr=document.createElement('tr');
    for(const cell of row.children){if(!['TD','TH'].includes(cell.tagName))continue;
     const td=document.createElement(cell.tagName.toLowerCase());td.textContent=cell.textContent;tr.append(td)}
    clean.append(tr)}target.append(clean)}
  const restoredExtras=new Set();
  for(const node of source.body.children){if(node.matches('.breakdown-total,.hint.note')){
   const kind=node.matches('.breakdown-total')?'total':'note';
   if(restoredExtras.has(kind))continue;restoredExtras.add(kind);
   const div=document.createElement(node.tagName.toLowerCase());div.className=node.className;div.textContent=node.textContent;target.append(div)}}
  $('breakdown-status').textContent=data.breakdownStatus||'Saved breakdown';
  $('breakdown-details').open=false;
  snapshotNotice(data.created);
  snapshotMessage('Viewing a frozen snapshot. The figures will not change until you click Calculate.');
 }
async function restoreShareSnapshot(){
 const id=new URL(location.href).searchParams.get('s');
 const fragment=location.hash.slice(1);
 if(!id&&!fragment.startsWith(snapshotPrefix))return;
 snapshotMessage('Loading frozen snapshot…');
 try{
  let data;
  if(id){
   if(!/^[a-f0-9]{24}$/.test(id))throw Error('Invalid snapshot ID');
   const response=await fetch(SNAPSHOT_API+'/snapshots/'+id);
   if(!response.ok)throw await snapshotResponseError(response);
   data=await response.json();
  }else data=await decodeSnapshot(fragment.slice(snapshotPrefix.length));
  applyShareSnapshot(data);
 }catch(e){snapshotMessage('This snapshot link could not be opened: '+e.message)}
}
restoreShareSnapshot();




// Optional screenshot-based bug reports. The Cloudflare /bugs endpoint must be deployed separately.
(function initBugReporter(){
 const open=$('bug-open'),dialog=$('bug-dialog'),form=$('bug-form');
 if(!open||!dialog||!form)return;
 const preview=$('bug-preview'),captureStatus=$('bug-capture-status'),status=$('bug-status');
 let screenshot=null,previewUrl=null,capturing=false;
 function setPreview(file){
  screenshot=file;
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl=file?URL.createObjectURL(file):null;
  if(file){preview.src=previewUrl;preview.hidden=false;}else{preview.removeAttribute('src');preview.hidden=true;}
 }
 function message(text){status.hidden=false;status.textContent=text;}
 function loadCaptureLibrary(){
  if(window.html2canvas)return Promise.resolve(window.html2canvas);
  return new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
   script.onload=()=>window.html2canvas?resolve(window.html2canvas):reject(Error('Screenshot library unavailable'));
   script.onerror=()=>reject(Error('Screenshot library could not load'));
   document.head.append(script);
  });
 }
 async function capturePage(){
  if(capturing)return;
  capturing=true;$('bug-capture').disabled=true;
  captureStatus.textContent='Capturing page…';
  try{
   const html2canvas=await loadCaptureLibrary();
   // Temporarily hide the modal to capture the actual page rather than the report form.
   dialog.close();
   try{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const canvas=await html2canvas(document.body,{backgroundColor:'#0d1421',useCORS:true,scale:Math.min(1.25,window.devicePixelRatio||1),windowWidth:document.documentElement.scrollWidth,windowHeight:document.documentElement.scrollHeight,scrollY:0,logging:false});
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));
    if(!blob)throw Error('Could not encode screenshot');
    if(blob.size>3_000_000)throw Error('Screenshot is over 3 MB; please attach a smaller image instead');
    setPreview(new File([blob],'every-little-bit-bug.jpg',{type:'image/jpeg'}));
    $('bug-screenshot').checked=true;
    captureStatus.textContent='Screenshot ready. Review the preview before sending.';
   }finally{dialog.showModal();}
  }catch(e){captureStatus.textContent='Automatic screenshot unavailable: '+e.message+'. You can attach one manually or send without a screenshot.';}
  finally{capturing=false;$('bug-capture').disabled=false;}
 }
 open.addEventListener('click',()=>{status.hidden=true;dialog.showModal();if($('bug-screenshot').checked&&!screenshot)capturePage();});
 $('bug-close').addEventListener('click',()=>dialog.close());
 $('bug-capture').addEventListener('click',capturePage);
 $('bug-screenshot').addEventListener('change',e=>{if(e.target.checked&&!screenshot)capturePage();});
 $('bug-upload').addEventListener('change',()=>{
  const file=$('bug-upload').files[0];if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>3_000_000){captureStatus.textContent='Please choose a PNG, JPEG or WebP image under 3 MB.';return;}
  setPreview(file);$('bug-screenshot').checked=true;captureStatus.textContent='Attached screenshot ready for review.';
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  const description=$('bug-description').value.trim();
  if(description.length<10){message('Please describe the problem in at least 10 characters.');return;}
  if(!$('bug-consent').checked){message('Please confirm you have reviewed what will be sent.');return;}
  const button=$('bug-send');button.disabled=true;message('Sending bug report…');
  try{
   const data=new FormData();data.set('description',description);
   data.set('page',location.origin+location.pathname+location.search);
   data.set('browser',navigator.userAgent.slice(0,350));
   if($('bug-screenshot').checked&&screenshot)data.set('screenshot',screenshot,screenshot.name);
   const response=await fetch(SNAPSHOT_API+'/bugs',{method:'POST',body:data});
   if(!response.ok){let detail='HTTP '+response.status;try{const j=await response.json();if(j.error)detail=j.error;}catch(e){}throw Error(detail);}
   message('Bug report sent. Thank you! o7');
    trackUsage('bug_report_sent');
   form.reset();setPreview(null);captureStatus.textContent='';
  }catch(e){message('Could not send the report: '+e.message+'. Please try again later.');}
  finally{button.disabled=false;}
 });
})();
