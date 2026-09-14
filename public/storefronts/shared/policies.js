(function(){
  'use strict';
  const cfg=window.STOREFRONT_CONFIG||{};
  const root=document.getElementById('policy-root');
  if(!root||!cfg.brandSlug)return;
  const checkoutOrigin=location.hostname.endsWith('netlify.app')?location.origin:'https://limitlesscheckout.netlify.app';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[char]));
  const row=(title,text)=>`<section class="policy-card"><span class="eyebrow">${esc(title)}</span><p>${esc(text)}</p></section>`;
  async function load(){
    try{
      const response=await fetch(`${checkoutOrigin}/api/storefront/${encodeURIComponent(cfg.brandSlug)}/policies`,{cache:'no-store'});
      const result=await response.json();
      if(!response.ok||!result.policy)throw new Error(result.error||'Policy unavailable');
      const p=result.policy;
      const privacy=Object.values(p.privacy||{}).map((text,index)=>row(index===0?'PRIVACY':'DATA RETENTION',text)).join('');
      const specifics=(p.productSpecific||[]).map(text=>row('PRODUCT-SPECIFIC NOTE',text)).join('');
      const support=p.support?.email?`<a href="mailto:${esc(p.support.email)}">${esc(p.support.email)}</a>`:'Support contact is not configured yet.';
      root.innerHTML=`
        ${!result.approved?'<div class="policy-notice">PREVIEW · These customer policies have not been approved for live launch yet.</div>':''}
        <div class="policy-grid">
          ${row('STANDARD SHIPPING',p.shipping.standard)}
          ${row('PRIORITY PROCESSING',p.shipping.priority)}
          ${row('TAXES & TOTALS',p.shipping.taxes)}
          ${row('RETURNS',p.returns.returns)}
          ${row('CANCELLATIONS',p.returns.cancellations)}
          ${privacy}${specifics}
          <section class="policy-card"><span class="eyebrow">CUSTOMER SUPPORT</span><p>${support}</p></section>
        </div>
        <p class="policy-updated">Policy version ${esc(p.version)}${result.approvedAt?` · approved ${esc(new Date(result.approvedAt).toLocaleDateString())}`:''}</p>`;
    }catch{
      root.innerHTML='<div class="policy-notice">Customer policy details could not be loaded. Please return to the store and try again later.</div>';
    }
  }
  void load();
})();