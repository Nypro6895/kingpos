import "server-only";
// The authorized live workflow retains historical evidence, but does not publish
// new frozen bases. Keep the authenticated endpoint without claiming any jobs.
export const PAYROLL_ENGINE_VERSION="live-with-history-1";
export async function closeDuePayrollPeriods(){return{configured:true,mode:"live" as const,skipped:true,published:0,failed:0};}
