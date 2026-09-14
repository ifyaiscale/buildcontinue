(function(){
  const cfg=window.STOREFRONT_CONFIG;
  if(!cfg) return;
  const cart=new Map();
  const $=(q,r=document)=>r.querySelector(q); const $$=(q,r=document)=>[...r.querySelectorAll(q)];
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  function setupMedia(){ $$('.media-shell img,.media-shell video').forEach(el=>{ const shell=el.closest('.media-shell'); const miss=()=>shell?.classList.add('missing'); el.addEventListener('error',miss); if(el.tagName==='IMG'&&el.complete&&el.naturalWidth===0) miss(); }); }
  function cartCount(){return [...cart.values()].reduce((s,x)=>s+x.quantity,0)}
  function cartTotal(){return [...cart.values()].reduce((s,x)=>s+x.quantity*x.price,0)}
  function refreshCart(){
    $$('[data-cart-count]').forEach(el=>el.textContent=String(cartCount()));
    const list=$('#cart-items'); if(!list) return; list.innerHTML='';
    if(!cart.size){list.innerHTML='<p class="product-copy">Your bag is empty.</p>'}
    for(const item of cart.values()){
      const row=document.createElement('div'); row.className='cart-line';
      row.innerHTML=`<div><strong>${item.name}</strong><span>${item.quantity} × ${money(item.price)}</span></div><button type="button" aria-label="Remove ${item.name}">Remove</button>`;
      row.querySelector('button').onclick=()=>{cart.delete(item.variantId);refreshCart()}; list.append(row);
    }
    $('#cart-total').textContent=money(cartTotal());
  }
  function addProduct(button){
    const card=button.closest('[data-product]'); const variantId=card.dataset.variant; const name=card.dataset.name; const price=Number(card.dataset.price); const qty=Math.max(1,Math.min(20,Number($('.qty',card)?.value||1)));
    const prev=cart.get(variantId); cart.set(variantId,{variantId,name,price,quantity:Math.min(20,(prev?.quantity||0)+qty)}); refreshCart(); openCart();
  }
  function openCart(){ $('#cart-drawer')?.classList.add('open'); document.body.style.overflow='hidden'; }
  function closeCart(){ $('#cart-drawer')?.classList.remove('open'); document.body.style.overflow=''; }
  async function checkout(){
    if(!cart.size) return;
    if(cfg.checkoutEnabled===false){ alert(cfg.checkoutDisabledMessage||'Checkout is not available yet.'); return; }
    if(!window.LimitlessCheckout){ alert('Secure checkout is still loading. Please try again.'); return; }
    const items=[...cart.values()].map(({variantId,quantity})=>({variantId,quantity}));
    window.LimitlessCheckout.start({brandSlug:cfg.brandSlug,items});
  }
  $$('[data-add]').forEach(b=>b.addEventListener('click',()=>addProduct(b)));
  $$('[data-open-cart]').forEach(b=>b.addEventListener('click',openCart));
  $$('[data-close-cart]').forEach(b=>b.addEventListener('click',closeCart));
  $('#checkout-button')?.addEventListener('click',checkout);
  $('#sticky-cart')?.addEventListener('click',()=>cart.size?openCart():document.querySelector('#shop')?.scrollIntoView({behavior:'smooth'}));
  setupMedia();refreshCart();
})();