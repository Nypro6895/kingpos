import {runAccountErasures} from '@/lib/account-erasure-worker';
import {runLifecycleExportExpiry} from '@/lib/lifecycle-export-expiry';
import {runPublicImageStagingExpiry} from '@/lib/public-image-staging-expiry';
import {runPublicPostMediaDeletions} from '@/lib/public-post-media-deletion';
import {runRightsImageEvidence} from '@/lib/rights-evidence-worker';
import {createAccountMaintenanceHandler} from '@/lib/account-maintenance-route';
export const maxDuration=300;
// Reuse the existing authenticated cadence. Policy remains disabled in SQL;
// this wiring neither assigns an operator nor grants removal intent.
export const GET=createAccountMaintenanceHandler({
 authorization:()=>process.env.CRON_SECRET?`Bearer ${process.env.CRON_SECRET}`:null,
 backgroundDisabled:()=>process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH==='1',
 erase:runAccountErasures,exports:runLifecycleExportExpiry,staging:runPublicImageStagingExpiry,
 postMedia:runPublicPostMediaDeletions,rights:stage=>runRightsImageEvidence(stage),
});
