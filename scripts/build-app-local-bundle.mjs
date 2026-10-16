import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const policy = JSON.parse(await fs.readFile(path.join(root, 'lib/app-local-command-policy.json'), 'utf8'));
const ownerPathsForBuild=new Set(['/pos','/pos/check-in','/pos/book','/pos/ticket','/pos/report']);
const commandNames = new Map();
const imports = [], mapping = [];
for (const [module, names] of Object.entries(policy.modules)) {
  if (!/^app\/[\w./-]+\.tsx?$/.test(module) || module.includes('..') || new Set(names).size !== names.length) throw Error('Invalid pinned action module: ' + module);
  const source = await fs.readFile(path.join(root, module), 'utf8');
  if (!/^\s*["']use server["'];/.test(source)) throw Error('Pinned actions must use the original server boundary: ' + module);
  for (const name of names) {
    if (!new RegExp('export\\s+async\\s+function\\s+' + name + '\\b').test(source)) throw Error('Pinned original action is missing: ' + module + '#' + name);
    const id = 'action.' + digest(module + '#' + name).slice(0, 24), alias = 'action' + imports.length;
    commandNames.set(module + '#' + name, id);
    imports.push(`import {${name} as ${alias}} from ${JSON.stringify('@/' + module.replace(/\.tsx?$/,''))};`);
    mapping.push(`${JSON.stringify(id)}: (values: unknown[]) => (${alias} as unknown as (...args: unknown[]) => unknown)(...values),`);
  }
}
await fs.writeFile(path.join(root, 'lib/app-local-commands-server.generated.ts'), `// Generated from the reviewed, explicit app-local-command-policy.json.\nimport "server-only";\n${imports.join('\n')}\nconst commands: Record<string,(values:unknown[])=>unknown>={\n${mapping.join('\n')}\n};\nexport async function runAppLocalCommand(name:string, values:unknown[]){const action=commands[name];if(!action)throw Object.assign(new Error("Unsupported form"),{status:404});return await action(values);}\n`);

const output = path.join(root, 'ios/Reylumi/LocalAppBundle');
// Only this exact generated directory may be replaced; never traverse a caller path.
if (path.dirname(output) !== path.join(root, 'ios/Reylumi')) throw Error('Unsafe local bundle output');
await fs.mkdir(output, { recursive: true });
await fs.rm(path.join(output,'manifest.json'), { force: true });
const wrappers = 'app-local-next';
const unsupported = new Map();
const nextPlugin = {
  name: 'installed-client-boundaries', setup(builder) {
    builder.onResolve({ filter: /^next\/(?:link|image|navigation|dynamic|form)$/ }, args => ({ path: args.path, namespace: wrappers }));
    builder.onResolve({filter:/^@\/lib\/workspace-navigation$/},()=>({path:path.join(root,'lib/app-local-shell-workspace-navigation.ts')}));
    builder.onResolve({ filter: /^@\/components\/experience-scope$/ }, () => ({ path: path.join(root, 'app/local-app/scope.tsx') }));
    builder.onLoad({ filter: /.*/, namespace: wrappers }, args => {
      const navigation = path.join(root, 'app/local-app/navigation.tsx').replaceAll('\\', '/');
      const contents = args.path === 'next/link' ? `export {AppLocalLink as default,useLinkStatus} from ${JSON.stringify(navigation)}` : args.path === 'next/image' ? `export {AppLocalImage as default} from ${JSON.stringify(navigation)}` : args.path === 'next/form' ? `export {AppLocalForm as default} from ${JSON.stringify(navigation)}` : args.path === 'next/navigation' ? `export * from ${JSON.stringify(navigation)}` : `import React,{lazy,Suspense} from 'react';export default function dynamic(loader,options={}){const View=lazy(()=>loader().then(value=>({default:value.default??value})));return function Dynamic(props){return React.createElement(Suspense,{fallback:options.loading?React.createElement(options.loading):null},React.createElement(View,props))}}`;
      return { contents, loader: 'js', resolveDir: root };
    });
    builder.onResolve({ filter: /^(?:server-only|node:|fs$|crypto$|next\/(?:headers|server|cache|font))/ }, args => { throw Error('Server implementation must not enter the installed app: ' + args.path + ' from ' + args.importer); });
    builder.onLoad({ filter: /\.[tj]sx?$/ }, async args => {
      if (args.path.includes('node_modules')) return;
      const text = await fs.readFile(args.path, 'utf8');
      if (!/^\s*["']use server["'];/.test(text)) return;
      const originalModule = path.relative(root, args.path).replaceAll('\\', '/');
      const ast = ts.createSourceFile(originalModule, text, ts.ScriptTarget.Latest, true);
      const names = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.name?.text).filter(Boolean);
      const proxies = names.map(name => {
        const id = commandNames.get(originalModule + '#' + name);
        if (id) return `export const ${name}=(...values)=>invokeAppLocalCommand(${JSON.stringify(id)},values,${!/^(load|get|search|referenceLoveStates)/.test(name)},${JSON.stringify(originalModule)});`;
        unsupported.set(originalModule + '#' + name, true);
        return `export const ${name}=()=>{throw new Error(${JSON.stringify('__unsupported_action:' + originalModule + '#' + name)})};`;
      });
      return { contents: `import {invokeAppLocalCommand} from ${JSON.stringify(path.join(root,'lib/app-local-command-client.ts').replaceAll('\\','/'))};\n${proxies.join('\n')}`, loader: 'js', resolveDir: root };
    });
  }
};
// Only these already-public configuration values enter the JavaScript bundle.
const publicConfig = {NEXT_PUBLIC_APP_URL:'https://reylumi.com',...Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_MAPTILER_KEY','NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY'].map(key => [key, process.env[key]?.trim() ?? '']))};
const result = await build({ absWorkingDir: root, entryPoints: ['app/local-app/entry.tsx'], outfile: path.join(output, 'app.js'), bundle: true, format: 'iife', platform: 'browser', target: ['safari16'], minify: true, metafile: true, jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), plugins: [nextPlugin], loader: { '.png': 'file', '.svg': 'file', '.woff2': 'file' }, define: { 'process.env.NODE_ENV': '"production"', ...Object.fromEntries(Object.entries(publicConfig).map(([key,value])=>['process.env.'+key,JSON.stringify(value)])) } });
const js = await fs.readFile(path.join(output, 'app.js'), 'utf8');
const viewCSS = await fs.readFile(path.join(output,'app.css'),'utf8').catch(()=> '');
const activeUnsupported = [...unsupported.keys()].filter(name => js.includes('__unsupported_action:' + name));
if (activeUnsupported.length) throw Error('Original action adapters are not yet pinned:\n' + activeUnsupported.join('\n'));
// Use exactly the current site styles and all application class candidates.
const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss');
const cssInput = await fs.readFile(path.join(root, 'app/globals.css'), 'utf8') + '\n' + await fs.readFile(path.join(root, 'components/settings-style.css'), 'utf8') + '\n' + viewCSS + '\n' + await fs.readFile(path.join(root, 'app/local-app/app.css'), 'utf8');
const css = await postcss([tailwind({ base: root, optimize: true })]).process(cssInput, { from: path.join(root, 'app/globals.css'), to: path.join(output, 'app.css') });
await fs.writeFile(path.join(output, 'app.css'), css.css);
await fs.copyFile(path.join(root, 'app/local-app/index.html'), path.join(output, 'index.html'));
// Metadata is exported separately below; never evaluate client component code or a server import during packaging.
const reference = await build({ absWorkingDir: root, entryPoints: ['lib/app-local-reference-content.ts'], bundle: true, write: false, format: 'cjs', platform: 'node' });
const referenceModule = { exports: {} }; new Function('module','exports',reference.outputFiles[0].text)(referenceModule,referenceModule.exports); const ref = referenceModule.exports;
for (const asset of ref.APP_LOCAL_REFERENCE_ASSETS) {
  if (!asset.startsWith('/') || asset.includes('..') || asset.includes('\\')) throw Error('Invalid reference asset');
  const destination = path.join(output,asset.slice(1)); await fs.mkdir(path.dirname(destination),{recursive:true}); await fs.copyFile(path.join(root,'public',asset.slice(1)),destination);
}
async function copyPublicAssets(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const absolute=path.join(directory,entry.name);if(entry.isDirectory())await copyPublicAssets(absolute);else if(/\.(?:png|jpg|jpeg|svg|webp|avif|woff2?)$/i.test(entry.name)){const relative=path.relative(path.join(root,'public'),absolute);const destination=path.join(output,relative);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(absolute,destination);}}}
await copyPublicAssets(path.join(root,'public'));
// The existing map view loads this same-origin script lazily. Install the exact
// pinned dependency so its first use never downloads executable code.
await fs.mkdir(path.join(output,'api/vendor'),{recursive:true});
await fs.copyFile(require.resolve('maplibre-gl/dist/maplibre-gl.js'),path.join(output,'api/vendor/maplibre-gl'));
await fs.mkdir(path.join(output,'brand'),{recursive:true}); await fs.copyFile(path.join(root,'public/brand/reylumi-favicon.png'),path.join(output,'brand/reylumi-favicon.png'));
await fs.mkdir(path.join(output,'fonts'),{recursive:true}); for(const font of ['Geist','Manrope']) await fs.copyFile(path.join(root,`app/fonts/${font}.woff2`),path.join(output,`fonts/${font}.woff2`));
const routes = ['/help','/help/:slug','/legal','/terms','/privacy','/community','/business-terms', '/pos','/pos/check-in','/pos/book','/pos/ticket','/pos/report'];
const metadata = await build({ absWorkingDir: root, stdin: { contents: `export {APP_LOCAL_READ_RESOURCES} from './lib/app-local-role-resources';export {APP_LOCAL_PLATFORM_READS,ROLE_READS,ROLE_COMMANDS} from './lib/app-local-platform-types';export {APP_LOCAL_HTTP_READS,APP_LOCAL_HTTP_COMMANDS} from './lib/app-local-http-client';export * from './lib/app-local-personal-metadata';export * from './lib/app-local-business-metadata';export * from './lib/app-local-explore-metadata';export * from './lib/app-local-public-metadata';export * from './lib/app-local-daily-metadata';export * from './lib/app-local-business-http-metadata';export * from './lib/app-local-secondary-metadata';export * from './lib/app-local-payroll-tax-metadata';export * from './lib/app-local-commerce-metadata';export * from './lib/app-local-shell-metadata';export * from './lib/app-local-portable-metadata';export * from './lib/app-local-portable-http-metadata';export * from './lib/app-local-display-metadata';export {APP_LOCAL_UPLOAD_COMMANDS} from './lib/app-local-upload-policy';`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node' });
const metaModule={exports:{}};new Function('module','exports',metadata.outputFiles[0].text)(metaModule,metaModule.exports);const meta=metaModule.exports;
const reads = Object.entries(meta.APP_LOCAL_READ_RESOURCES).filter(([name])=>name!=='market.catalog').map(([name,rule])=>({name,path:'/api/app-local/read',argumentKeys:rule.params,access:'scoped',cacheable:true}));
for(const[name,rule]of Object.entries(meta.APP_LOCAL_PLATFORM_READS))reads.push({name,path:'/api/app-local/read',argumentKeys:rule.argumentKeys,access:'scoped',cacheable:rule.retention!=='none'});
for(const name of ['owner.workspace','owner.check-in','owner.bookings','owner.tickets','owner.reports'])reads.push({name,path:'/api/app-local/read',argumentKeys:name==='owner.check-in'?['query','ids']:['query'],access:'scoped',cacheable:true});
for(const rule of meta.APP_LOCAL_HTTP_READS)reads.push({name:rule.name,path:'/api/app-local/read',argumentKeys:rule.args,access:rule.name==='app.connection'?'public':'scoped',cacheable:false});
for(const[name,rule]of Object.entries(meta.ROLE_READS))reads.push({name,path:'/api/app-local/read',argumentKeys:rule.argumentKeys,access:'scoped',cacheable:false});
for(const[name,rule]of Object.entries(meta.APP_LOCAL_PERSONAL_READS))reads.push({name,path:'/api/app-local/read',argumentKeys:rule.argumentKeys,access:'scoped',cacheable:rule.cacheable});
for(const[name,rule]of Object.entries({...meta.APP_LOCAL_BUSINESS_READS,...meta.APP_LOCAL_DAILY_READS,...meta.APP_LOCAL_BUSINESS_HTTP_READS,...meta.APP_LOCAL_SECONDARY_READS,...meta.APP_LOCAL_PAYROLL_TAX_READS,...meta.APP_LOCAL_COMMERCE_READS,...meta.APP_LOCAL_PORTABLE_READS,...meta.APP_LOCAL_DISPLAY_READS}))reads.push({name,path:'/api/app-local/read',argumentKeys:rule.argumentKeys,access:rule.access??'scoped',cacheable:rule.retention==='scoped'});
for(const rule of [...meta.APP_LOCAL_EXPLORE_READS,...meta.APP_LOCAL_PUBLIC_READS,...meta.APP_LOCAL_SHELL_READS])reads.push({name:rule.name,path:'/api/app-local/read',argumentKeys:rule.argumentKeys,access:'scoped',cacheable:rule.retain});
reads.push({name:'staff.relay',path:'/api/app-local/read',argumentKeys:['staffId'],access:'scoped',cacheable:true});
const ownerPageRegistry=JSON.parse(await fs.readFile(path.join(root,'lib/app-local-owner-page-registry.json'),'utf8'));
for(const[name,rule]of Object.entries(ownerPageRegistry.reads))reads.push({name,path:'/api/app-local/read',argumentKeys:rule.argumentKeys,access:'scoped',cacheable:rule.cacheable});
for(const[name,rule]of Object.entries(meta.APP_LOCAL_PORTABLE_HTTP_READS))reads.push({name,path:'/api/app-local/read',argumentKeys:rule.argumentKeys,access:'scoped',cacheable:false});
const commands=[...commandNames.values()].filter(name=>js.includes(name)).map(name=>({name,path:'/api/app-local/command',argumentKeys:['values']}));
for(const rule of meta.APP_LOCAL_HTTP_COMMANDS)commands.push({name:rule.name,path:'/api/app-local/command',argumentKeys:rule.args});
for(const[name,rule]of Object.entries(meta.ROLE_COMMANDS))commands.push({name,path:'/api/app-local/command',argumentKeys:rule.argumentKeys});
for(const[name,rule]of Object.entries({...meta.APP_LOCAL_PERSONAL_COMMANDS,...meta.APP_LOCAL_UPLOAD_COMMANDS,...meta.APP_LOCAL_PORTABLE_HTTP_COMMANDS}))commands.push({name,path:'/api/app-local/command',argumentKeys:rule.argumentKeys});
for(const rule of [...meta.APP_LOCAL_EXPLORE_COMMANDS,...meta.APP_LOCAL_PUBLIC_COMMANDS,...meta.APP_LOCAL_SHELL_COMMANDS])commands.push({name:rule.name,path:'/api/app-local/command',argumentKeys:rule.argumentKeys});
const registrySource=await fs.readFile(path.join(root,'lib/app-local-page-registry.tsx'),'utf8');
// Every route is explicitly registered by its renderer; inventory-only routes cannot pass the activation gate.
const routeRegistry=JSON.parse(await fs.readFile(path.join(root,'lib/app-local-page-paths.json'),'utf8'));
for(const route of routeRegistry.routes)if(!routes.includes(route))routes.push(route);
for(const route of [...meta.APP_LOCAL_PERSONAL_PATHS,...meta.APP_LOCAL_BUSINESS_ROUTES,...meta.APP_LOCAL_EXPLORE_PATHS,...meta.APP_LOCAL_PUBLIC_PATHS,...meta.APP_LOCAL_DAILY_ROUTES,...meta.APP_LOCAL_SECONDARY_ROUTES,...meta.APP_LOCAL_PAYROLL_TAX_ROUTES,...meta.APP_LOCAL_COMMERCE_ROUTES,...meta.APP_LOCAL_PORTABLE_ROUTES,...meta.APP_LOCAL_DISPLAY_ROUTES,...ownerPageRegistry.routes])if(!routes.includes(route))routes.push(route);
if(new Set(reads.map(rule=>rule.name)).size!==reads.length||new Set(commands.map(rule=>rule.name)).size!==commands.length)throw Error('Duplicate pinned local resource');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.json':'application/json'};
async function filesIn(dir){const values=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const absolute=path.join(dir,entry.name);if(entry.isDirectory())values.push(...await filesIn(absolute));else if(entry.name!=='manifest.json'){const bytes=await fs.readFile(absolute),relative=path.relative(output,absolute).replaceAll('\\','/');values.push({path:relative,bytes:bytes.length,sha256:digest(bytes),mime:relative==='api/vendor/maplibre-gl'?'text/javascript':mime[path.extname(relative)]??''});}}return values.sort((a,b)=>a.path.localeCompare(b.path));}
const files=await filesIn(output);if(files.some(file=>!file.mime))throw Error('Unsupported bundle asset');
const inventory=JSON.parse(await fs.readFile(path.join(root,'lib/app-local-route-inventory.generated.json'),'utf8'));
const routeReview=JSON.parse(await fs.readFile(path.join(root,'lib/app-local-online-routes.json'),'utf8'));
const online=new Map(routeReview.groups.flatMap(group=>group.routes.map(route=>[route,group.reason])));
for(const[family,variants]of Object.entries(routeReview.boundedFamilies)){if(!variants.every(route=>routes.includes(route)))throw Error('A bounded route family is incomplete: '+family);if(!routes.includes(family))routes.push(family);}
const absent=inventory.routes.map(route=>route.route.replace(/\[([^\]]+)\]/g,':$1')).filter(route=>!routes.includes(route));
const missing=absent.filter(route=>!online.has(route)),onlineRoutes=absent.filter(route=>online.has(route)).map(path=>({path,reason:online.get(path)}));
const activate=process.argv.includes('--activate');
if(activate&&(missing.length||!publicConfig.NEXT_PUBLIC_SUPABASE_URL||!publicConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY))throw Error('Cannot activate an incomplete or unconfigured local application');
const connectOrigins=[];if(publicConfig.NEXT_PUBLIC_SUPABASE_URL){const url=new URL(publicConfig.NEXT_PUBLIC_SUPABASE_URL);if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.port||url.username||url.password||url.pathname!=='/')throw Error('Unexpected public realtime origin');connectOrigins.push(url.origin,url.origin.replace('https:','wss:'));}
const mapOrigins=publicConfig.NEXT_PUBLIC_MAPTILER_KEY?['https://api.maptiler.com']:[];
const manifest={version:1,productionReady:activate&&missing.length===0,buildId:digest(JSON.stringify(files)),entry:'index.html',connectOrigins,mapOrigins,files,routes:routes.map(route=>({path:route,adapter:route.startsWith('/help')?'help-full':ownerPathsForBuild.has(route)?'owner-workspace':route,access:isPublicForBuild(route)?'public':'scoped'})),reads,commands,help:{version:ref.APP_LOCAL_REFERENCE_VERSION,slugs:ref.APP_LOCAL_HELP_GUIDES.map(guide=>guide.slug),languages:['en','vi']},coverage:{total:inventory.pageCount,bundled:inventory.pageCount-absent.length,ordinaryEligible:inventory.pageCount-onlineRoutes.length,registeredPatterns:routes.length,missing,online:onlineRoutes,boundedFamilies:routeReview.boundedFamilies}};
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.mkdir(path.join(root,'artifacts/app-local-platform-20261016'),{recursive:true});await fs.writeFile(path.join(root,'artifacts/app-local-platform-20261016/bundle-report.json'),JSON.stringify({buildId:manifest.buildId,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),routes:routes.length,productionReady:manifest.productionReady,missing,commands:commands.length,inputs:Object.keys(result.metafile.inputs)},null,2));
console.log(JSON.stringify({buildId:manifest.buildId,files:files.length,routes:routes.length,commands:commands.length,productionReady:manifest.productionReady,missing:missing.length}));
void registrySource;
function isPublicForBuild(route){return ['/help','/help/:slug','/legal','/terms','/privacy','/community','/business-terms'].includes(route);}
