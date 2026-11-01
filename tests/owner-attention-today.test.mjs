import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
test('all Today entry phases use the salon clock even when an old date URL is supplied',async()=>{
 const path='lib/today-dashboard.ts',tree=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getTodayDashboard');
 const code=ts.transpileModule(fn.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const deps={isTodayDashboardSection:phase=>['staff','bookings','waiting','financials','extras'].includes(phase),measureTodayRead:(_,read)=>read(),loadBusinessClock:async()=>({date:'2026-11-01',timezone:'America/Chicago'}),buildDayView:input=>({selectedDate:input.selectedDateInput??input.currentDate,currentDate:input.currentDate}),canUsePermission:()=>false,canUseAnyPermission:()=>false,DAILY_POS_REPORT_PERMISSIONS:{view:'reports.view'},unavailableSalonBusinessHours:()=>({}),emptyDashboard:({clock})=>clock};
 const exports={};new Function('exports',...Object.keys(deps),code)(exports,...Object.values(deps));
 for(const phase of [undefined,'shell','core','staff','bookings','waiting','financials','extras'])for(const date of ['2026-10-31',['2026-10-31'],'invalid'])assert.deepEqual(await exports.getTodayDashboard({}, {date,phase}),{date:'2026-11-01',timezone:'America/Chicago'});
});
