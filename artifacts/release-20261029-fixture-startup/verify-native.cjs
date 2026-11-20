const fs=require('fs'),path=require('path');
const p='artifacts/release-20261029-fixture-startup/',dir=process.argv[2],run=Number(process.argv[3]),uploadOnly=process.argv.includes('--upload-only');
if(!dir||!Number.isSafeInteger(run))throw Error('Explicit artifact directory and run required');
const get=n=>JSON.parse(fs.readFileSync(path.join(dir,n))),expected=JSON.parse(fs.readFileSync(p+'native-expected.json')),inventory=JSON.parse(fs.readFileSync(p+'expected-test-inventory.json'));
const provenance=get('local-bundle-provenance.json'),signed=get('testflight-receipt.json'),unsigned=get('build-receipt.json'),execution=get('test-execution-receipt.json'),log=fs.readFileSync(path.join(dir,'test.log'),'utf8'),failures=[];
const equal=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
if([provenance.source.commit,signed.commit,unsigned.commit].some(c=>c!==expected.commit))failures.push('source commit');
const fileMap=new Map(expected.files.map(f=>[f.path,f]));
for(const file of provenance.source.files){const f=fileMap.get(file.path);if(!f||f.sha256!==file.sha256||f.bytes!==file.bytes)failures.push('source:'+file.path);}
if(provenance.source.files.length!==expected.files.length||provenance.source.sha256!==expected.sourceSha256)failures.push('source aggregate');
const source=new Map(provenance.source.files.map(f=>[f.path,f.sha256])),bundle=new Map(provenance.bundle.files.map(f=>[f.path,f.sha256])),generated=new Map((provenance.generatedMappings||[]).map(f=>[f.path,f.sha256]));
const expectedHash=name=>name.startsWith('Reylumi/LocalAppBundle/')?bundle.get(name.slice('Reylumi/LocalAppBundle/'.length)):source.get('ios/'+name)||generated.get('ios/'+name);
for(const [file,sha]of Object.entries(signed.source_sha256))if(expectedHash(file)!==sha)failures.push('signed:'+file);
for(const [file,sha]of Object.entries(unsigned.sourceSHA256))if(expectedHash(file)!==sha)failures.push('unsigned:'+file);
const started=[...log.matchAll(/Test Case '-\[ReylumiTests\.(\w+) (test\w+)\]' started\./g)].map(x=>x[1]+'/'+x[2]);
const passed=[...log.matchAll(/Test Case '-\[ReylumiTests\.(\w+) (test\w+)\]' passed \(/g)].map(x=>x[1]+'/'+x[2]);
const failed=[...log.matchAll(/Test Case .* (?:failed|skipped) \(/g)];
if(inventory.expectedCases.length!==235||!equal(started,inventory.expectedCases)||!equal(passed,inventory.expectedCases)||new Set(passed).size!==235||failed.length||log.includes('** TEST EXECUTE FAILED **')||(log.match(/\*\* TEST EXECUTE SUCCEEDED \*\*/g)||[]).length!==14)failures.push('exact235 runtime case coverage /14 hosts');
if(!execution.coverageVerified||execution.expectedCount!==235||execution.passedCount!==235||execution.failureCount!==0||execution.hostInvocations!==14||!equal(execution.expectedCases,inventory.expectedCases)||!equal(execution.passedCases,inventory.expectedCases)||JSON.stringify(unsigned.testExecution)!==JSON.stringify(execution))failures.push('coverage receipt / unsigned archive binding');
const newWK=passed.includes('LocalAppWebViewTests/testLostStartupResetRecoversContextWithoutReplayingCommands');
if(!newWK)failures.push('startup recovery test');
if(signed.upload!=='accepted'||unsigned.simulatorTests!=='passed')failures.push('upload / unsigned archive');
if(provenance.generator?.servicesCatalogPilot!==false||!provenance.generator?.arguments?.includes('--activate')||!provenance.publicConfiguration?.NEXT_PUBLIC_SUPABASE_URL?.present||!provenance.publicConfiguration?.NEXT_PUBLIC_SUPABASE_ANON_KEY?.present)failures.push('production activation/configuration or Services pilot');
let apple=null;
if(!uploadOnly){apple=get(fs.existsSync(path.join(dir,'testflight-processing.json'))?'testflight-processing.json':'testflight-processing-independent.json');if(apple.processingState!=='VALID'||apple.build!==signed.build)failures.push('Apple processing');}
const out={at:new Date().toISOString(),run,commit:expected.commit,version:signed.version,build:signed.build,sourceFiles:provenance.source.files.length,sourceSha256:provenance.source.sha256,bundleFiles:provenance.bundle.files.length,bundleSha256:provenance.bundle.sha256,signedArchiveFiles:Object.keys(signed.source_sha256).length,unsignedArchiveFiles:Object.keys(unsigned.sourceSHA256).length,nativeTests:passed.length,nativeFailures:failed.length,hostInvocations:14,exactRuntimeCoverageVerified:!failures.some(x=>/coverage|235/.test(x)),coverageInventorySha256:execution.caseInventorySha256,newWKRecoveryTestPassed:newWK,upload:signed.upload,processingState:apple?.processingState||'pending-independent-GET-readback',internalBuildState:apple?.internalBuildState||null,failures,productionActivation:true,servicesCatalogPilot:false,physicalAcceptance:false,physicalLimitation:'New binary physical acceptance NOT RUN; separate Personal audit active on actual70 after recovery330; old68 and328/329 evidence retained separately; root has no device controller'};
fs.writeFileSync(p+(uploadOnly?'native-source-upload-verified.json':'native-verified.json'),JSON.stringify(out,null,2));console.log(out);if(failures.length)process.exitCode=1;
