import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';

test('Camera web fallback retains the entry, never invents an install link, and fetches only destination metadata', async () => {
  const {outputFiles} = await build({entryPoints:['app/check-in/[entry]/page.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',plugins:[{
    name:'landing-boundary',setup(b) {
      b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:a.path,external:true}));
      b.onResolve({filter:/^(next\/link|next\/navigation|@\/components\/experience-page|@\/lib\/supabase\/server)$/},a=>({path:a.path,namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:
        path==='next/link' ? `const React=require('react');module.exports=({children,...p})=>React.createElement('a',p,children);` :
        path==='next/navigation' ? `exports.notFound=()=>{throw Error('NOT_FOUND')};` :
        path.includes('experience-page') ? `exports.withExperiencePage=x=>x;` :
        `exports.createSupabaseServerClient=()=>({rpc:async(name,args)=>{globalThis.__cameraCalls.push({name,args});return globalThis.__cameraResult}});` }));
    },
  }]});
  const module={exports:{}};new Function('require','module','exports',outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const page=module.exports,entry='00000000-0000-4000-8000-000000000200',props={params:Promise.resolve({entry})};
  const saved=process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL;
  try {
    globalThis.__cameraCalls=[];globalThis.__cameraResult={data:'Basic QR salon',error:null};
    delete process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL;
    let html=renderToStaticMarkup(await page.default(props));
    assert.match(html,new RegExp(`reylumi://check-in/${entry}`));assert.match(html,new RegExp(`/qr\\?entry=${entry}`));
    assert.ok(!html.includes('apps.apple.com'));assert.match(html,/invited testers/);
    assert.deepEqual(globalThis.__cameraCalls,[{name:'personal_checkin_destination',args:{p_entry:entry}}]);
    assert.deepEqual(await page.generateMetadata(props),{});
    process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL='javascript:alert(1)';
    html=renderToStaticMarkup(await page.default(props));assert.ok(!html.includes('javascript:'));assert.deepEqual(await page.generateMetadata(props),{});
    process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL='https://testflight.apple.com/join/TESTONLY';
    html=renderToStaticMarkup(await page.default(props));assert.match(html,/After installing, return to this page/);
    assert.deepEqual(await page.generateMetadata(props),{},'TestFlight URL must not imply public App Store listing');
    process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL='https://apps.apple.com/app/id6821394475';
    assert.equal((await page.generateMetadata(props)).itunes.appArgument,`https://reylumi.com/check-in/${entry}`);
    globalThis.__cameraResult={data:null,error:null};html=renderToStaticMarkup(await page.default(props));
    assert.match(html,/Check-in unavailable/);assert.ok(!html.includes('reylumi://'));
    const before=globalThis.__cameraCalls.length;
    await assert.rejects(page.default({params:Promise.resolve({entry:'invalid'})}),/NOT_FOUND/);
    assert.equal(globalThis.__cameraCalls.length,before,'invalid entry never calls DB');
  } finally {
    if(saved===undefined)delete process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL;else process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL=saved;
    delete globalThis.__cameraCalls;delete globalThis.__cameraResult;
  }
});
