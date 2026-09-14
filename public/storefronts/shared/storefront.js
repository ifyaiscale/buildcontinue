(function(){
  const cfg=window.STOREFRONT_CONFIG;
  if(!cfg) return;
  const cart=new Map();
  const $=(q,r=document)=>r.querySelector(q); const $$=(q,r=document)=>[...r.querySelectorAll(q)];
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  function track(event,detail={}){
    const payload={event,brand:cfg.brandSlug,currency:'USD',...detail};
    try{window.dispatchEvent(new CustomEvent('limitless:commerce',{detail:payload}));}catch{}
    if(Array.isArray(window.dataLayer))window.dataLayer.push(payload);
  }
  window.LimitlessStorefrontAnalytics=Object.freeze({track});
  function setupMedia(){
    $$('.media-shell img,.media-shell video').forEach(el=>{
      const shell=el.closest('.media-shell');
      const card=el.closest('[data-product]');
      if(cfg.brandSlug==='cozyinfants' && card && el.tagName==='IMG' && /^https?:/.test(el.getAttribute('src')||'')){
        const current=el.src;
        const key=(card.dataset.name||'').split(' ')[0].toLowerCase();
        if(key){el.dataset.fallback=current;el.dataset.fallbackTried='';el.src=`assets/${key}.webp`;}
      }
      const miss=()=>{
        const fallback=el.dataset.fallback;
        if(fallback && !el.dataset.fallbackTried){el.dataset.fallbackTried='true';el.src=fallback;return;}
        shell?.classList.add('missing');
      };
      el.addEventListener('error',miss);
      if(el.tagName==='IMG'&&el.complete&&el.naturalWidth===0) miss();
    });
  }
  function cartCount(){return [...cart.values()].reduce((s,x)=>s+x.quantity,0)}
  function cartTotal(){return [...cart.values()].reduce((s,x)=>s+x.quantity*x.price,0)}
  function refreshCart(){
    $$('[data-cart-count]').forEach(el=>el.textContent=String(cartCount()));
    const list=$('#cart-items'); if(!list) return; list.innerHTML='';
    if(!cart.size){list.innerHTML='<p class="product-copy">Your bag is empty.</p>'}
    for(const item of cart.values()){
      const row=document.createElement('div'); row.className='cart-line';
      const personalized=item.personalizationRef?'<span class="cart-personalized">✓ Personalized photo attached</span>':'';
      row.innerHTML=`<div><strong>${item.name}</strong><span>${item.quantity} × ${money(item.price)}</span>${personalized}</div><button type="button" aria-label="Remove ${item.name}">Remove</button>`;
      row.querySelector('button').onclick=()=>{
        cart.delete(item.variantId);
        track('remove_from_cart',{variantId:item.variantId,quantity:item.quantity,displayValue:item.price*item.quantity});
        refreshCart();
      };
      list.append(row);
    }
    $('#cart-total').textContent=money(cartTotal());
  }
  function personalizationFields(){
    if(!cfg.personalizationRequired) return {};
    const fields=window.FaceJamasPersonalization?.cartFields?.();
    if(!fields){
      alert('Upload and confirm your photo before adding a FaceJamas product.');
      document.querySelector('#customize')?.scrollIntoView({behavior:'smooth'});
      return null;
    }
    return fields;
  }
  function addProduct(button){
    const card=button.closest('[data-product]'); const variantId=card.dataset.variant; const name=card.dataset.name; const price=Number(card.dataset.price); const qty=Math.max(1,Math.min(20,Number($('.qty',card)?.value||1)));
    const personal=personalizationFields(); if(personal===null) return;
    const prev=cart.get(variantId);
    const samePersonalization=!cfg.personalizationRequired || prev?.personalizationRef===personal.personalizationRef;
    const quantity=samePersonalization?Math.min(20,(prev?.quantity||0)+qty):qty;
    cart.set(variantId,{variantId,name,price,quantity,...personal});
    track('add_to_cart',{variantId,name,quantity:qty,displayUnitPrice:price,displayValue:price*qty,personalized:Boolean(personal.personalizationRef)});
    refreshCart(); openCart();
  }
  function openCart(){ $('#cart-drawer')?.classList.add('open'); document.body.style.overflow='hidden'; }
  function closeCart(){ $('#cart-drawer')?.classList.remove('open'); document.body.style.overflow=''; }
  async function checkout(){
    if(!cart.size) return;
    if(cfg.checkoutEnabled===false){ alert(cfg.checkoutDisabledMessage||'Checkout is not available yet.'); return; }
    if(!window.LimitlessCheckout){ alert('Secure checkout is still loading. Please try again.'); return; }
    const items=[...cart.values()].map(({variantId,quantity,personalizationRef,personalizationProof})=>({variantId,quantity,...(personalizationRef?{personalizationRef,personalizationProof}:{})}));
    track('begin_checkout',{itemCount:cartCount(),lineCount:cart.size,displayValue:cartTotal(),personalized:items.some(item=>Boolean(item.personalizationRef))});
    window.LimitlessCheckout.start({brandSlug:cfg.brandSlug,items,checkoutOrigin:cfg.checkoutOrigin});
  }
  $$('[data-add]').forEach(b=>b.addEventListener('click',()=>addProduct(b)));
  $$('[data-open-cart]').forEach(b=>b.addEventListener('click',openCart));
  $$('[data-close-cart]').forEach(b=>b.addEventListener('click',closeCart));
  $('#checkout-button')?.addEventListener('click',checkout);
  $('#sticky-cart')?.addEventListener('click',()=>cart.size?openCart():document.querySelector('#shop')?.scrollIntoView({behavior:'smooth'}));
  setupMedia();refreshCart();
  const products=$$('[data-product]').map(card=>({variantId:card.dataset.variant,name:card.dataset.name,displayPrice:Number(card.dataset.price)}));
  track('view_item_list',{products});
})();