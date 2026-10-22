"use client";
import {useEffect,useRef} from "react";
import {usePathname} from "next/navigation";
import {audienceEnabled,countAudience,pageCategory,sourceCategory,trackSiteEvent,type SiteEvent} from "@/lib/site-analytics";
import {analyticsPreferenceEvent,appStorePlacement} from "@/lib/analytics-preferences";

export function SiteAnalytics(){
  const pathname=usePathname();
  const first=useRef(true);
  useEffect(()=>{
    // Remove the retired campaign marker; never create or read campaign context.
    try{document.cookie="__Host-puls-campaign=; Path=/; Max-Age=0; Secure; SameSite=Lax";}catch{/* Cookie blocking must not interrupt the page. */}
    let counted=false;
    function record(){if(!counted && audienceEnabled()){counted=countAudience("pageview",{page:pageCategory(pathname),source:first.current?sourceCategory(document.referrer):"internal"});if(counted)first.current=false;}}
    record();window.addEventListener(analyticsPreferenceEvent,record);window.addEventListener("storage",record);
    return ()=>{window.removeEventListener(analyticsPreferenceEvent,record);window.removeEventListener("storage",record);};
  },[pathname]);
  useEffect(()=>{
    let active=true;
    const page=pageCategory(location.pathname);
    // Bundled first-party library; only metric names and three rating buckets leave the page.
    let installed=false;
    function startPerformance(){if(installed || !active || !audienceEnabled())return;
    void import("web-vitals").then(({onLCP,onINP,onCLS,onTTFB,onFCP})=>{
      if(installed || !active || !audienceEnabled())return;installed=true;
      for(const observe of [onLCP,onINP,onCLS,onTTFB,onFCP])observe(({name,rating})=>{if(active)countAudience("performance",{page,metric:name,rating});});
    });}
    startPerformance();window.addEventListener(analyticsPreferenceEvent,startPerformance);window.addEventListener("storage",startPerformance);
    function click(event:MouseEvent){
      if(!event.isTrusted || !(event.target instanceof Element))return;
      const link=event.target.closest<HTMLAnchorElement>("a[href]");if(!link)return;
      let name:SiteEvent|undefined;
      try{const url=new URL(link.href,location.origin);
        if(url.hostname==="apps.apple.com" || (url.origin===location.origin && /^\/r\/[a-z0-9][a-z0-9-]{2,63}\/store$/.test(url.pathname)))name="app_store_click";
        else if(url.hostname==="github.com" && url.pathname.startsWith("/PulsHealth/"))name="github_click";
        else if(url.hostname==="app.pulshealth.com")name=url.pathname.startsWith("/signup")?"hosted_signup_click":url.pathname.startsWith("/demo")?"demo_click":"hosted_signin_click";
        else if(url.origin===location.origin && url.pathname.startsWith("/docs"))name="docs_click";
        else if(url.protocol==="mailto:")name="contact_click";
      }catch{return;}
      if(name)trackSiteEvent(name,name==="app_store_click"?{placement:appStorePlacement(link.dataset.analyticsPlacement)}:undefined);
    }
    document.addEventListener("click",click);return ()=>{active=false;document.removeEventListener("click",click);window.removeEventListener(analyticsPreferenceEvent,startPerformance);window.removeEventListener("storage",startPerformance);};
  },[]);
  return null;
}
