import {readFileSync,writeFileSync} from 'node:fs';
const inputs=process.argv.slice(2);
if(inputs.length<2)throw new Error('Provide output followed by benchmark JSON reports.');
const output=inputs.shift();
const reports=inputs.map(file=>({file,report:JSON.parse(readFileSync(file,'utf8'))}));
const signature=report=>JSON.stringify([report.databaseMigrationSha256,report.corrections]);
if(reports.some(({report})=>report.failure||!report.completedAt||signature(report)!==signature(reports[0].report)))throw new Error('Completed reports with identical SQL stack required.');
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)]??null;
const round=n=>n===null?null:Math.round(n*100)/100;
const summary={generatedAt:new Date().toISOString(),mode:reports[0].report.mode,
 sourceReports:reports.map(({file,report})=>({file,startedAt:report.startedAt,completedAt:report.completedAt})),
 databaseMigrationSha256:reports[0].report.databaseMigrationSha256,corrections:reports[0].report.corrections,
 environment:reports[0].report.environment,limitations:reports[0].report.limitations,
 measurementNote:'Runs retain their chronological setup and warm-cache history. Different scales are not controlled cold-disk comparisons.',
 runs:reports.flatMap(({file,report})=>report.runs.map(run=>({...run,sourceReport:file,groups:run.groups.map(group=>{
  const summarize=events=>({requests:events.length,p50Ms:round(percentile(events.map(e=>e.ms),.5)),p95Ms:round(percentile(events.map(e=>e.ms),.95))});
  return {...group,firstPage:group.firstPage??summarize(group.events.filter(e=>e.page===0)),
   continuation:group.continuation??summarize(group.events.filter(e=>e.page>0))};
 })})))
};
writeFileSync(output,JSON.stringify(summary,null,2));
for(const run of summary.runs)for(const group of run.groups)console.log(JSON.stringify({salons:run.salons,concurrency:group.concurrency,
 firstPage:group.firstPage,continuation:group.continuation,errors:group.errors,timeouts:group.timeouts,duplicates:group.duplicates}));
