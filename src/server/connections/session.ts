/**
 * "Sign in inside mneme": for sources with no feed and no export button, the
 * app opens the site in a WebView, the person logs in as they normally would,
 * and a script running in the page fetches their own data and hands it back
 * as a file. Credentials never leave the phone; mneme only ever sees the
 * resulting file, which goes through the ordinary import door.
 *
 * The scripts live here, served to the app, so a selector change is a deploy
 * and not an App Store release. Each script must end by calling
 * `window.ReactNativeWebView.postMessage(JSON.stringify(...))` with
 * `{ type: "file", filename, text }`, `{ type: "progress", message }`, or
 * `{ type: "error", message }`. Everything the script reads is from the
 * person's own account pages, the same way their browser would.
 *
 * Sources for the endpoints and selectors (community tooling, 2026-08-23):
 * obsidian-kindle-plugin, lesander/netflix-viewing-activity, freeyourstuff
 * Goodreads plugin, crunchyroll-rs, yt-playlist-export. Unverified on a
 * device from here — see the design doc's "open" list.
 */

export type SessionTarget = {
  key: "kindle" | "goodreads" | "netflix" | "crunchyroll" | "youtube-liked";
  name: string;
  /** One line on the card: what comes over. */
  what: string;
  /** Where the WebView starts; the person signs in here. */
  startUrl: string;
  /** When the URL matches this, they're in and the script may run. */
  readyPattern: string;
  /** Shown while the script works. */
  working: string;
  filename: string;
  script: string;
};

const post = `function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));}`;

const kindle = `(async()=>{${post}
try{
  post({type:"progress",message:"reading your library…"});
  const base=location.origin;
  const lib=[...document.querySelectorAll(".kp-notebook-library-each-book")];
  if(lib.length===0){post({type:"error",message:"no books found — open the notebook page with your highlights first"});return;}
  const books=[];
  for(let i=0;i<lib.length;i++){
    const el=lib[i];const asin=el.id;
    const title=(el.querySelector("h2.kp-notebook-searchable")||{}).textContent||"";
    const author=((el.querySelector("p.kp-notebook-searchable")||{}).textContent||"").replace(/^By:\\s*/,"");
    const lastAnnotated=(el.querySelector("[id^=kp-notebook-annotated-date]")||{}).value||null;
    post({type:"progress",message:"book "+(i+1)+" of "+lib.length+"…"});
    let state="",token="";const highlights=[];
    for(let page=0;page<50;page++){
      const r=await fetch(base+"/notebook?asin="+encodeURIComponent(asin)+"&contentLimitState="+encodeURIComponent(state)+"&token="+encodeURIComponent(token),{credentials:"include"});
      if(!r.ok)break;
      const doc=new DOMParser().parseFromString(await r.text(),"text/html");
      doc.querySelectorAll(".a-row.a-spacing-base").forEach(row=>{
        const h=row.querySelector("#highlight, .kp-notebook-highlight");const n=row.querySelector("#note");
        const text=h?h.textContent.trim():"";const note=n?n.textContent.trim():"";
        if(text||note)highlights.push({text,note:note||null,location:(row.querySelector("#kp-annotation-location")||{}).value||null});
      });
      const nextToken=(doc.querySelector(".kp-notebook-annotations-next-page-start")||{}).value||"";
      state=(doc.querySelector(".kp-notebook-content-limit-state")||{}).value||"";
      if(!nextToken)break;token=nextToken;
    }
    books.push({asin,title:title.trim(),author:author.trim(),lastAnnotated,highlights});
  }
  post({type:"file",filename:"kindle-notebook.json",text:JSON.stringify({source:"kindle-notebook",books})});
}catch(e){post({type:"error",message:"couldn't read your kindle notebook — "+(e&&e.message||e)});}
})();true;`;

const goodreads = `(async()=>{${post}
try{
  post({type:"progress",message:"asking goodreads for your library…"});
  const page=await (await fetch("/review/import",{credentials:"include"})).text();
  const csrf=(page.match(/name="csrf-token" content="([^"]+)"/)||[])[1];
  const uid=(page.match(/\\/user\\/show\\/(\\d+)/)||[])[1];
  if(!csrf||!uid){post({type:"error",message:"goodreads didn't show an export page — are you signed in?"});return;}
  await fetch("/review_porter/export/"+uid,{method:"POST",credentials:"include",headers:{"X-CSRF-Token":csrf,"X-Requested-With":"XMLHttpRequest","Content-Type":"application/x-www-form-urlencoded"},body:"format=json"});
  const url="/review_porter/export/"+uid+"/goodreads_export.csv";
  for(let i=0;i<120;i++){
    await new Promise(r=>setTimeout(r,2000));
    post({type:"progress",message:"goodreads is building the file… "+(i*2)+"s"});
    const r=await fetch(url,{credentials:"include"});
    if(r.ok){const text=await r.text();if(/^Book Id,/.test(text)){post({type:"file",filename:"goodreads_library_export.csv",text});return;}}
  }
  post({type:"error",message:"goodreads took too long to build the export — try again in a few minutes"});
}catch(e){post({type:"error",message:"couldn't export from goodreads — "+(e&&e.message||e)});}
})();true;`;

const netflix = `(async()=>{${post}
try{
  const ctx=window.netflix&&window.netflix.reactContext&&window.netflix.reactContext.models;
  if(!ctx){post({type:"error",message:"open your viewing activity page first (account → profile → viewing activity)"});return;}
  const authURL=ctx.memberContext.data.userInfo.authURL;const build=ctx.serverDefs.data.BUILD_IDENTIFIER;const api=ctx.services.data.api.path[1];
  const items=[];
  for(let pg=0;pg<200;pg++){
    post({type:"progress",message:"reading page "+(pg+1)+"…"});
    const r=await fetch(location.origin+"/api/"+api+"/"+build+"/viewingactivity?pg="+pg+"&pgSize=100&_="+Date.now()+"&authURL="+encodeURIComponent(authURL),{credentials:"same-origin"});
    if(!r.ok)break;const j=await r.json();const rows=(j&&j.viewedItems)||[];
    rows.forEach(v=>items.push({title:v.title||v.videoTitle||"",series:v.seriesTitle||null,date:v.date||null}));
    if(rows.length===0)break;
  }
  if(items.length===0){post({type:"error",message:"no viewing activity found for this profile"});return;}
  post({type:"file",filename:"netflix-activity.json",text:JSON.stringify({source:"netflix",items})});
}catch(e){post({type:"error",message:"couldn't read your netflix activity — "+(e&&e.message||e)});}
})();true;`;

const crunchyroll = `(async()=>{${post}
try{
  post({type:"progress",message:"signing the request…"});
  const tok=await fetch(location.origin+"/auth/v1/token",{method:"POST",credentials:"include",headers:{"Authorization":"Basic bm9haWhkZXZtXzZpeWcwYThsMHE6","Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=etp_rt_cookie&scope=offline_access&device_id="+crypto.randomUUID()+"&device_type=Chrome%20on%20iOS"});
  if(!tok.ok){post({type:"error",message:"crunchyroll didn't accept the session — are you signed in?"});return;}
  const {access_token,account_id}=await tok.json();
  let acct=account_id;
  if(!acct){const me=await (await fetch(location.origin+"/accounts/v1/me",{headers:{Authorization:"Bearer "+access_token}})).json();acct=me.account_id;}
  const items=[];
  for(let page=1;page<=30;page++){
    post({type:"progress",message:"reading history page "+page+"…"});
    const r=await fetch(location.origin+"/content/v2/"+acct+"/watch-history?page="+page+"&page_size=100&locale=en-US",{headers:{Authorization:"Bearer "+access_token}});
    if(!r.ok)break;const j=await r.json();const rows=(j&&j.data)||[];
    rows.forEach(x=>{const p=x.panel||{};const m=p.episode_metadata||{};items.push({series:m.series_title||p.title||"",episode:p.title||null,date:x.date_played||null,seriesId:m.series_id||null});});
    if(rows.length<100)break;
  }
  post({type:"file",filename:"crunchyroll-history.json",text:JSON.stringify({source:"crunchyroll",items})});
}catch(e){post({type:"error",message:"couldn't read your crunchyroll history — "+(e&&e.message||e)});}
})();true;`;

const youtubeLiked = `(async()=>{${post}
try{
  const seen=new Set();let stable=0;
  for(let i=0;i<120&&stable<4;i++){
    const before=seen.size;
    document.querySelectorAll('a#video-title[href*="watch?v="], a.yt-simple-endpoint[href*="watch?v="]').forEach(a=>{const m=a.getAttribute("href").match(/[?&]v=([A-Za-z0-9_-]{11})/);if(m)seen.add(m[1]+"\\t"+(a.getAttribute("title")||a.textContent||"").trim().replace(/\\t/g," "));});
    post({type:"progress",message:seen.size+" liked videos so far…"});
    window.scrollTo(0,document.documentElement.scrollHeight);
    await new Promise(r=>setTimeout(r,900));
    stable=seen.size===before?stable+1:0;
  }
  if(seen.size===0){post({type:"error",message:"no liked videos showed up — open youtube.com/playlist?list=LL while signed in"});return;}
  const rows=["Video ID,Title",...[...seen].map(s=>{const [id,t]=s.split("\\t");return id+',"'+(t||"").replace(/"/g,'""')+'"';})];
  post({type:"file",filename:"youtube-liked.csv",text:rows.join("\\n")});
}catch(e){post({type:"error",message:"couldn't read your liked videos — "+(e&&e.message||e)});}
})();true;`;

export const SESSION_TARGETS: SessionTarget[] = [
  { key: "kindle", name: "kindle", what: "your highlights and notes, every book.", startUrl: "https://read.amazon.com/notebook", readyPattern: "^https://read\\.amazon\\.[a-z.]+/notebook", working: "reading your kindle notebook…", filename: "kindle-notebook.json", script: kindle },
  { key: "goodreads", name: "goodreads (full library)", what: "your whole library, reviews and private notes — even a private shelf.", startUrl: "https://www.goodreads.com/review/import", readyPattern: "^https://www\\.goodreads\\.com/review/import", working: "exporting your goodreads library…", filename: "goodreads_library_export.csv", script: goodreads },
  { key: "netflix", name: "netflix", what: "everything this profile has watched.", startUrl: "https://www.netflix.com/viewingactivity", readyPattern: "^https://www\\.netflix\\.com/(viewingactivity|settings/viewed)", working: "reading your viewing activity…", filename: "netflix-activity.json", script: netflix },
  { key: "crunchyroll", name: "crunchyroll", what: "your watch history.", startUrl: "https://www.crunchyroll.com/history", readyPattern: "^https://www\\.crunchyroll\\.com/([a-z]{2}/)?history", working: "reading your crunchyroll history…", filename: "crunchyroll-history.json", script: crunchyroll },
  { key: "youtube-liked", name: "youtube likes", what: "the videos you've liked.", startUrl: "https://www.youtube.com/playlist?list=LL", readyPattern: "^https://(www|m)\\.youtube\\.com/playlist\\?list=LL", working: "scrolling through your likes…", filename: "youtube-liked.csv", script: youtubeLiked },
];
