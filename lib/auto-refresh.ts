// Poll shared snapshots frequently; provider requests have their own server cooldown.
export const AUTO_REFRESH_MS=30000;
export function startAutoRefresh(doc:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>,win:Pick<Window,'setInterval'|'clearInterval'|'addEventListener'|'removeEventListener'>,refresh:()=>void,isBusy:()=>boolean,now=Date.now){
 let lastAttempt=0;
 const check=()=>{const at=now();if(doc.visibilityState!=='visible'||isBusy()||at-lastAttempt<AUTO_REFRESH_MS)return;lastAttempt=at;refresh();};
 const timer=win.setInterval(check,AUTO_REFRESH_MS);
 doc.addEventListener('visibilitychange',check);win.addEventListener('focus',check);win.addEventListener('online',check);
 return()=>{win.clearInterval(timer);doc.removeEventListener('visibilitychange',check);win.removeEventListener('focus',check);win.removeEventListener('online',check);};
}
