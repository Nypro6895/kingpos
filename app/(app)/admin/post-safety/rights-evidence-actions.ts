'use server';
import {captureRightsEvidence,loadRightsCaseEvidence,requestRightsOriginRemoval,type RightsCaptureInput,type RightsRemovalInput} from '@/lib/platform-admin/rights-evidence';
export async function loadRightsEvidenceCaseAction(caseId:string){return loadRightsCaseEvidence(caseId);}
export async function captureRightsEvidenceAction(input:RightsCaptureInput){return captureRightsEvidence(input);}
export async function requestRightsOriginRemovalAction(input:RightsRemovalInput){return requestRightsOriginRemoval(input);}
