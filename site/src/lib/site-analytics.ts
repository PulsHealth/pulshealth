import {excludedInThisBrowser, appStorePlacement} from "./analytics-preferences";
import {postAudience} from "./audience-request";
export type SiteEvent =
  | "app_store_click" | "github_click" | "hosted_signin_click" | "hosted_signup_click" | "demo_click" | "docs_click" | "contact_click"
  | "updates_submit" | "updates_success" | "updates_error"
  | "consulting_submit" | "consulting_success" | "consulting_error" | "article_share";
const endpoint=process.env.NEXT_PUBLIC_ANALYTICS_URL;
const website=process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID;
const pages=["docs","knowledge-base","blog","pro","pricing","consulting","server","about","support"];
export function pageCategory(pathname:string):string {return pathname==="/"?"home":pages.find(p=>pathname===`/${p}` || pathname.startsWith(`/${p}/`)) || "other";}
export function sourceCategory(referrer:string):string {
  try{const h=new URL(referrer).hostname;if(["pulshealth.com","www.pulshealth.com"].includes(h))return "internal";if(/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(h))return "search";if(/(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai)$/.test(h))return "ai";if(/(^|\.)(reddit\.com|facebook\.com|instagram\.com|linkedin\.com|t\.co|x\.com|bsky\.app)$/.test(h))return "social";return "other";}catch{return "direct";}
}
export function audienceEnabled():boolean {return typeof window!=="undefined" && !!endpoint && !!website && ["pulshealth.com","www.pulshealth.com"].includes(location.hostname) && !excludedInThisBrowser() && navigator.doNotTrack!=="1" && !(navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl;}
/** Bounded categories only. Never send an identifier, raw URL, form text or timing. */
export function countAudience(event:SiteEvent|"pageview"|"performance",data:{page?:string;placement?:string;source?:string;metric?:string;rating?:string}={}):boolean {
  if(!audienceEnabled())return false;
  const payload={website,hostname:location.hostname,event,page:data.page || pageCategory(location.pathname),...(event==="app_store_click"?{placement:appStorePlacement(data.placement)}:{}),...(event==="pageview"?{source:data.source || "direct"}:{}),...(event==="performance"?{metric:data.metric,rating:data.rating}:{})};
  try{void postAudience(`${endpoint!.replace(/\/$/,"")}/api/send`,JSON.stringify({type:"aggregate",payload}));return true;}catch{return false;}
}
export function trackSiteEvent(name:SiteEvent,data?:{placement:string}){countAudience(name,data);}
