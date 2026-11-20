"use client";

import {Children,createContext,isValidElement,useCallback,useContext,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode,type DetailsHTMLAttributes} from "react";
import {WorkspaceText} from "@/components/workspace-language";
import "./settings-child-pages.css";
import "./settings-compact-children.css";

type Page={id:string;parent:string|null;title:ReactNode};
type Navigation={active:string|null;register:(page:Page)=>()=>void;open:(id:string)=>void;back:()=>void;inPath:(id:string)=>boolean;close:(id:string)=>void};
const NavigationContext=createContext<Navigation|null>(null),ParentContext=createContext<string|null>(null);

/** Nested pages stay inside their original form. Hidden inputs still submit and drafts survive Back. */
export function SettingsChildPages({children,label="Settings",resetKey="",showTitle=false}:{children:ReactNode;label?:string;resetKey?:string;showTitle?:boolean}){
 const rootId=useId(),root=useRef<HTMLDivElement>(null),pages=useRef(new Map<string,Page>());
 const [trail,setTrail]=useState<Page[]>([]);
 const active=trail.at(-1)?.id||null,trailRef=useRef<Page[]>([]);
 useLayoutEffect(()=>{trailRef.current=trail;},[trail]);
 const activate=useCallback((id:string|null)=>{
  const next:Page[]=[],seen=new Set<string>();let current=id;
  while(current&&!seen.has(current)){seen.add(current);const page=pages.current.get(current);if(!page)break;next.unshift(page);current=page.parent;}
  setTrail(next);
 },[]);
 const hashTarget=useCallback(()=>{
  // A path opens deferred parents first; registering their children completes the route.
  let path:string[];try{path=decodeURIComponent(window.location.hash.slice(1)).split("/");}catch{return null;}
  return [...path].reverse().find(id=>pages.current.has(id))||null;
 },[]);
 const register=useCallback((page:Page)=>{
  pages.current.set(page.id,page);
  queueMicrotask(()=>{if(window.history.state?.reylumiSettingsChild?.root!==rootId&&trailRef.current.at(-1)?.id!==page.id&&hashTarget()===page.id&&pages.current.has(page.id))activate(page.id);});
  return()=>{pages.current.delete(page.id);queueMicrotask(()=>{if(!pages.current.has(page.id)&&trailRef.current.at(-1)?.id===page.id)activate(page.parent&&pages.current.has(page.parent)?page.parent:null);});};
 },[rootId,activate,hashTarget]);
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{
  const restore=()=>{const entry=window.history.state?.reylumiSettingsChild;activate(entry?.root===rootId?(pages.current.has(entry.id)?entry.id:null):hashTarget());};
  restore();window.addEventListener("popstate",restore);window.addEventListener("hashchange",restore);return()=>{window.removeEventListener("popstate",restore);window.removeEventListener("hashchange",restore);};
 },[rootId,resetKey,activate,hashTarget]);
 useLayoutEffect(()=>{if(active)heading.current?.focus({preventScroll:true});},[active]);
 function open(id:string){
  if(!pages.current.has(id))return;
  activate(id);window.history.pushState({...window.history.state,reylumiSettingsChild:{root:rootId,id}},"",window.location.href);
  requestAnimationFrame(()=>root.current?.scrollIntoView({block:"start"}));
 }
 function back(){
  const currentId=trailRef.current.at(-1)?.id;
  setTrail(current=>current.slice(0,-1));
  const entry=window.history.state?.reylumiSettingsChild;
  if(entry?.root===rootId&&entry.id===currentId)window.history.back();
  else if(hashTarget()===currentId){const parent=trailRef.current.at(-2)?.id;window.history.replaceState(window.history.state,"",window.location.pathname+window.location.search+(parent?"#"+encodeURIComponent(parent):""));}
 }
 const navigation:Navigation={active,open,back,
  register,
  close:id=>{
   const current=trailRef.current,index=current.findIndex(page=>page.id===id);if(index<0)return;
   setTrail(current.slice(0,index));const entry=window.history.state?.reylumiSettingsChild;
   if(entry?.root===rootId&&entry.id===current.at(-1)?.id)window.history.go(-(current.length-index));
   else if(hashTarget()===current.at(-1)?.id){const parent=current[index-1]?.id;window.history.replaceState(window.history.state,"",window.location.pathname+window.location.search+(parent?"#"+encodeURIComponent(parent):""));}
  },
  inPath:id=>trail.some(page=>page.id===id)
 };
 const page=trail.at(-1),parent=trail.at(-2);
 return <NavigationContext.Provider value={navigation}><ParentContext.Provider value={null}><div className="settings-child-pages" ref={root} data-settings-child-open={!!active} data-settings-root-title={showTitle} onInvalidCapture={event=>{
  const input=event.target as HTMLElement,entry=input.closest<HTMLElement>("[data-settings-child-id]");
  if(entry&&entry.dataset.settingsChildId!==active){event.preventDefault();open(entry.dataset.settingsChildId!);requestAnimationFrame(()=>input.focus());}
  else if(!entry&&active){event.preventDefault();activate(null);requestAnimationFrame(()=>input.focus());}
 }}>
  {page?<header className="settings-child-header"><button type="button" className="settings-child-back" onClick={back}>‹ {parent?.title||<WorkspaceText text={label}/>}</button><h3 ref={heading} tabIndex={-1}>{page.title}</h3></header>:showTitle?<h2 className="settings-child-overview-title"><WorkspaceText text={label}/></h2>:null}
  <div className="settings-child-content">{children}</div>
 </div></ParentContext.Provider></NavigationContext.Provider>;
}

export function SettingsChildPage({title,children,description,heading,danger=false,id:providedId,defer=false,resetKey=0}:{title:ReactNode;children:ReactNode;description?:ReactNode;heading?:ReactNode;danger?:boolean;id?:string;defer?:boolean;resetKey?:number}){
 const generated=useId(),id=providedId||generated,parent=useContext(ParentContext),navigation=useContext(NavigationContext);
 const [mounted,setMounted]=useState(false),[seen,setSeen]=useState(resetKey);
 const register=navigation?.register;
 // Register after every label/parent update without resetting the current page or form.
 useLayoutEffect(()=>register?.({id,parent,title}),[id,parent,title,register]);
 if(!navigation)return <details className="settings-child-fallback"><summary>{title}</summary>{children}</details>;
 const current=navigation.active===id,inPath=navigation.inPath(id);
 if(seen!==resetKey){setSeen(resetKey);setMounted(false);}else if(inPath&&!mounted)setMounted(true);
 return <div className={"settings-child-entry"+(danger?" settings-child-danger":"")} id={id} data-settings-child-id={id} data-settings-current={current} data-settings-in-path={inPath}>
  <button type="button" className="settings-child-launch" aria-expanded={inPath} aria-controls={id+"-body"} onClick={()=>navigation.open(id)}><span><span className="settings-child-label">{heading||title}</span>{description?<small>{description}</small>:null}</span><span aria-hidden="true">›</span></button>
  <div id={id+"-body"} className="settings-child-body" hidden={!inPath}><ParentContext.Provider value={id}>{!defer||mounted||inPath?children:null}</ParentContext.Provider></div>
 </div>;
}

/** Existing uncontrolled disclosures become child pages only inside the Settings workspace. */
export function SettingsDetails({children,...props}:DetailsHTMLAttributes<HTMLDetailsElement>){
 const navigation=useContext(NavigationContext);
 if(!navigation||props.onToggle)return <details {...props}>{children}</details>;
 const parts=Children.toArray(children),summary=parts.find(part=>isValidElement(part)&&part.type==="summary");
 if(!summary||!isValidElement<{children?:ReactNode;className?:string}>(summary))return <details {...props}>{children}</details>;
 return <SettingsChildPage title={summary.props.children} id={props.id} danger={`${props.className||""} ${summary.props.className||""}`.includes("text-red")}><div className={props.className}>{parts.filter(part=>part!==summary)}</div></SettingsChildPage>;
}

export function useSettingsChildNavigation(){return useContext(NavigationContext);}
