import fs from 'node:fs';
import {releaseReleaseLock} from '../../scripts/release-journal.mjs';
const p='artifacts/startup-prefetch-budget-20261029/',read=n=>JSON.parse(fs.readFileSync(p+n));
const r=read('release-receipt.json'),q=read('native-physical-verified.json'),n=read('run-40862237073.json'),a=read('run-40865769925.json');
const file='C:/Reylumi/kingpos/.git/reylumi-release.lock.json',lock=JSON.parse(fs.readFileSync(file)),acquired=JSON.parse(fs.readFileSync('artifacts/wave66/lock-acquisition.json'));
if(lock.owner!=='combined-settings-pos-payroll-checkwriter-20261029'||lock.token!==acquired.token||!r.targets.web.verified||!r.targets.ios.verified||!q.installedBeforeAfterVerified||q.failures.length||n.status!=='completed'||n.conclusion!=='success'||a.status!=='completed'||a.conclusion!=='success')throw Error('Owned verified release boundary / no active pipeline required');
try {
 fs.writeFileSync(p+'verified-final-boundary.json',JSON.stringify({at:new Date().toISOString(),receipt:r.id,web:r.targets.web.deploymentId,native:r.targets.ios.version+'('+r.targets.ios.build+')',source:r.targets.ios.commit,physicalFiniteBatchCompleted:true,noActiveRootPipelines:true,broadPerformanceNotUsedToHoldLock:true},null,2));
} finally {
 const result=releaseReleaseLock(acquired.token);
 const ack={at:new Date().toISOString(),receipt:r.id,owner:lock.owner,...result,lockFileAbsent:!fs.existsSync(file)};
 fs.writeFileSync(p+'release-lock-ack.json',JSON.stringify(ack,null,2));
 console.log(ack);
}
