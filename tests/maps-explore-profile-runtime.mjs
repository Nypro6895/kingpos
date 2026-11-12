import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const canonical='C:/Reylumi/kingpos';
const stubs={
 '@/components/workspace-language':'export const WorkspaceText=({text})=>text; export const useWorkspaceTranslation=()=>s=>s;',
 '@/components/explore-account-actions':'export const ExploreSalonLove=()=>null;export const ExploreBookButton=()=>null;',
 '@/components/salon-trust-line':'export const SalonTrustLine=()=>null;export const SalonVerifiedBadge=()=>null;',
 '@/components/salon-operating-status-badge':'export const SalonOperatingStatusBadge=()=>null;',
 '@/lib/salon-identity':'export const salonPopularPrice=()=>null;',
 'next/link':'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {ExploreMap} from './app/explore/explore-map';import {SalonLocationMap} from './components/salon-location-map';
window.React=React;window.stats={created:0,removed:0,moves:[],markers:[]};
window.maplibregl={Map:class {constructor(){stats.created++} addControl(){} on(){} resize(){} remove(){stats.removed++} easeTo(o){stats.moves.push(o)} fitBounds(){}},NavigationControl:class{},LngLatBounds:class{extend(){} isEmpty(){return false}},Marker:class{constructor({element}){this.element=element}setLngLat(coords){stats.markers.push(coords);return this}addTo(){document.querySelector('#markers').append(this.element);return this}remove(){this.element.remove()}}};
const salon=(id,lat=42)=>({id,name:'Salon '+id,latitude:lat,longitude:-88,trust:{},operatingStatus:{},distanceMiles:null});
const root=createRoot(document.querySelector('#root'));window.draw=(n=2,selected='a')=>root.render(<><ExploreMap maptilerKey="fixture" salons={Array.from({length:n},(_,i)=>salon(String.fromCharCode(97+i)))} selectedSalonId={selected} onSelectSalon={id=>window.selected=id}/><SalonLocationMap key="profile" address="420 6th St, Racine, WI" name="Salon a"/></>);window.savedMapApi=window.maplibregl;window.draw();`;
const built=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:null);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:root}));b.onResolve({filter:/^@\//},a=>{const base=path.join(root,a.path.slice(2));for(const suffix of ['.ts','.tsx']){try{readFileSync(base+suffix);return {path:base+suffix}}catch{}}const fallback=path.join(canonical,a.path.slice(2));for(const suffix of ['.ts','.tsx']){try{readFileSync(fallback+suffix);return {path:fallback+suffix}}catch{}}});}}]});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;const css=built.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><head><style>${css}</style></head><body><div id="root"></div><div id="markers"></div><script>${req.url==="/retry"?js.replace("window.draw();", "delete window.maplibregl;window.draw();"):js}</script></body></html>`)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://www.google.com/**',r=>r.fulfill({body:'<p>Map provider fixture</p>',contentType:'text/html'}));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.stats.created===1&&document.querySelector('#markers button'));
assert.equal(await page.locator('iframe').count(),0,'map does not contact Google before opening');
await page.evaluate(()=>window.draw(3,'b'));await page.waitForFunction(()=>document.querySelectorAll('#markers button').length===3);assert.equal(await page.evaluate(()=>stats.created),1,'result changes keep existing map');
await page.getByRole('button',{name:'Select Salon b on the map'}).click();assert.equal(await page.evaluate(()=>window.selected),'b');assert.equal(await page.getByRole('button',{name:'Select Salon b on the map'}).getAttribute('aria-pressed'),'true');
assert.match(await page.getByRole('link',{name:'Get directions'}).getAttribute('href'),/maps\/dir\/\?api=1&destination=42%2C-88/);
await page.getByRole('button',{name:'View map',exact:true}).click();assert.equal(await page.locator('iframe').count(),1);assert.equal(await page.getByRole('button',{name:'Hide map',exact:true}).getAttribute('aria-expanded'),'true');await page.getByRole('button',{name:'Hide map',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);
await page.evaluate(()=>window.draw(0));await page.waitForFunction(()=>stats.removed===1);await page.evaluate(()=>window.draw(1));await page.waitForFunction(()=>stats.created===2);assert.deepEqual(errors,[]);mkdirSync('artifacts/maps',{recursive:true});writeFileSync('artifacts/maps/runtime-result.json',JSON.stringify({passed:true,checks:['map survives results changes','marker selection callback and aria state','coordinate directions URL','profile map loads only on click','hide removes iframe','empty results clean up and repopulate','no browser errors'],viewport:'390x844',provider:'mocked; no live tiles acceptance'},null,2));const retry=await browser.newPage();let attempts=0;await retry.route('**/api/vendor/maplibre-gl',r=>{attempts++;return attempts===1?r.abort():r.fulfill({contentType:'text/javascript',body:'window.maplibregl=window.savedMapApi;'});});await retry.goto('http://127.0.0.1:'+server.address().port+'/retry');await retry.getByText('Map could not be loaded right now.').waitFor();await retry.evaluate(()=>window.draw(0));await retry.getByText('No mapped salons in this area yet.').waitFor();await retry.evaluate(()=>window.draw(1));await retry.waitForFunction(()=>stats.created===1);assert.equal(attempts,2);console.log('PASS: 8 browser runtime checks, including failed script retry');
}finally{await browser.close();await new Promise(r=>server.close(r));}
