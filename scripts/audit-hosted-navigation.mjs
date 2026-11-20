import fs from 'node:fs/promises';
import path from 'node:path';
const directory='artifacts/navigation-comment-audit-20261028';
await fs.mkdir(directory,{recursive:true});
const inventory=JSON.parse(await fs.readFile('lib/app-local-route-inventory.generated.json','utf8'));
const policy=await fs.readFile('ios/Reylumi/NavigationPolicy.swift','utf8');
const body=policy.slice(policy.indexOf('func needsHostedTaskControls'),policy.indexOf('func isSecurityChallengeResponse'));
const prefixes=[...body.matchAll(/"(\/[^"\n]*)"/g)].map(match=>match[1]).filter(value=>value!=='/');
const excluded=['/admin','/api/admin','/settings/recovery-back-office','/api/pos/windows-download'];
const matches=(value,prefix)=>value===prefix||value.startsWith(prefix+'/');
const routes=[];
async function walk(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.posix.join(directory,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name==='page.tsx'){const route='/'+file.slice(4,-9).split('/').filter(part=>part&&!/^\(.+\)$/.test(part)).join('/');const item=inventory.routes.find(item=>item.route===route);routes.push({route,source:file,roles:item?.roles??['existing-server-route-guard'],presentation:excluded.some(prefix=>matches(route,prefix))?'excluded':prefixes.some(prefix=>matches(route,prefix))?'explicit-task-text-exit':'ordinary-no-native-bar',roleEvidence:item?'route-inventory':'No role inference: existing server page guard remains authoritative'});}}}
await walk('app');routes.sort((a,b)=>a.route.localeCompare(b.route));
const controller=await fs.readFile('ios/Reylumi/ReylumiLocalAppViewController.swift','utf8');
if(/barButtonSystemItem:\s*\.done/.test(controller))throw Error('Persistent system Done control remains');
if(!controller.includes('self.updateHostedControls(controller, url: url)'))throw Error('Hosted route changes must refresh their controls');
const report={baseline:'iOS 1.0.0 (56), d58259afc3e90c6ccd9c2b0add5d2c009bfd1e45',scope:'All source page.tsx routes, independent of role; presentation audit only, not a claim of signed-in device acceptance',totalRoutes:routes.length,counts:Object.fromEntries(['excluded','explicit-task-text-exit','ordinary-no-native-bar'].map(key=>[key,routes.filter(row=>row.presentation===key).length])),roles:[...new Set(routes.flatMap(row=>row.roles))].sort(),sharedEntrypoints:['AppLocalLink/useRouter','installed document link interceptor (including hash links)','native online/open bridge','native WK navigation fallback'],external:'External HTTPS/Safari and trusted Stripe payment remain outside the ordinary internal-page presentation rule.',routes};
await fs.writeFile(path.join(directory,'all-routes.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({totalRoutes:report.totalRoutes,counts:report.counts,roles:report.roles}));
