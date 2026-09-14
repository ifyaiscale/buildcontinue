(function(){
  'use strict';
  const cfg=window.STOREFRONT_CONFIG||{};
  const MAX_BYTES=10*1024*1024;
  const ALLOWED=new Set(['image/jpeg','image/png','image/webp']);
  const REF=/^pers_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PROOF=/^[A-Za-z0-9_-]{40,100}$/;
  const state={ref:'',proof:'',previewUrl:'',expiresAt:0};
  const $=id=>document.getElementById(id);
  const track=(event,detail={})=>window.LimitlessStorefrontAnalytics?.track?.(event,detail);

  function status(message,tone){
    const el=$('facejamas-upload-status');
    if(!el)return;
    el.textContent=message;
    el.dataset.tone=tone||'neutral';
  }
  function clearStored(){
    state.ref='';state.proof='';state.expiresAt=0;
    document.documentElement.classList.remove('facejamas-personalization-ready');
  }
  function localPreview(file){
    if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);
    state.previewUrl=URL.createObjectURL(file);
    const image=$('facejamas-preview-image');
    const shell=$('facejamas-preview');
    if(image){image.src=state.previewUrl;image.alt='Your selected FaceJamas photo preview';}
    shell?.classList.add('has-preview');
  }
  function validateFile(file){
    if(!file)return 'Choose a photo first.';
    if(!ALLOWED.has(file.type))return 'Use a JPEG, PNG, or WebP photo.';
    if(file.size<1||file.size>MAX_BYTES)return 'Photo must be 10 MB or smaller.';
    return '';
  }
  async function upload(){
    const input=$('facejamas-photo');
    const consent=$('facejamas-consent');
    const button=$('facejamas-upload-button');
    const file=input?.files?.[0];
    const validation=validateFile(file);
    if(validation){status(validation,'error');track('personalization_upload_error',{reason:'file_validation'});return;}
    if(!consent?.checked){status('Confirm that you have permission to use this photo.','error');track('personalization_upload_error',{reason:'consent'});return;}
    if(!cfg.personalizationUploadUrl||!cfg.personalizationAnonKey){status('Private upload is not configured yet.','error');return;}

    clearStored();
    localPreview(file);
    if(button)button.disabled=true;
    status('Securing your photo…','working');
    track('personalization_upload_start',{fileType:file.type,fileSizeBucket:file.size<1_000_000?'under_1mb':file.size<5_000_000?'1_to_5mb':'5_to_10mb'});
    try{
      const form=new FormData();
      form.append('file',file,file.name||'facejamas-photo');
      form.append('consent','true');
      const response=await fetch(cfg.personalizationUploadUrl,{
        method:'POST',
        headers:{Authorization:`Bearer ${cfg.personalizationAnonKey}`,apikey:cfg.personalizationAnonKey},
        body:form,
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Your photo could not be uploaded securely.');
      const ref=String(result.personalizationRef||'');
      const proof=String(result.personalizationProof||'');
      const expiresAt=Date.parse(String(result.expiresAt||''));
      if(!REF.test(ref)||!PROOF.test(proof)||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new Error('The secure upload receipt could not be verified. Please try again.');
      state.ref=ref;state.proof=proof;state.expiresAt=expiresAt;
      document.documentElement.classList.add('facejamas-personalization-ready');
      status('Photo secured. Choose a product below to add it with this personalization.','success');
      track('personalization_upload_complete',{fileType:file.type});
      document.querySelectorAll('[data-add]').forEach(el=>el.removeAttribute('aria-disabled'));
    }catch(error){
      clearStored();
      status(error instanceof Error?error.message:'Your photo could not be uploaded securely.','error');
      track('personalization_upload_error',{reason:'upload'});
    }finally{if(button)button.disabled=false;}
  }

  $('facejamas-photo')?.addEventListener('change',event=>{
    clearStored();
    const file=event.currentTarget.files?.[0];
    const validation=validateFile(file);
    if(validation){status(validation,'error');return;}
    localPreview(file);
    status('Preview ready. Confirm permission, then secure this photo.','neutral');
    track('personalization_photo_selected',{fileType:file.type});
  });
  $('facejamas-upload-button')?.addEventListener('click',upload);

  window.FaceJamasPersonalization=Object.freeze({
    cartFields(){
      if(!state.ref||!state.proof||state.expiresAt<=Date.now())return null;
      return {personalizationRef:state.ref,personalizationProof:state.proof};
    },
    reset:clearStored,
  });
})();