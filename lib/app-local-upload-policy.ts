const posFiles = ["customer_background_image_file", "customer_left_ad_image_file", "customer_right_ad_image_file"] as const;
const posFields = ["group","expected","app_download_url","customer_left_ad_text","customer_right_ad_text","customer_promo_title","customer_promo_body","customer_show_salon_name","customer_show_customer_name","customer_show_receipt_status","customer_show_service_name","customer_show_staff_name","customer_show_barcode","current_customer_background_image_path","current_customer_left_ad_image_path","current_customer_right_ad_image_path","remove_customer_background_image","remove_customer_left_ad_image","remove_customer_right_ad_image","large_turn_threshold","staff_check_in_enabled","touch_keyboard_enabled","tip_suggestion_1","tip_suggestion_2","tip_suggestion_3","tip_suggestion_4","showStaff","showServices","showCustomer","showTip","showDiscount","idleMinutes","idleWarningSeconds"] as const;
/** Only reviewed original File actions; each still invokes its original handler. */
export const APP_LOCAL_FILE_ACTIONS = {
  "action.8bf63c94a49e4c5fa9fe2817": { kind: "support", fileKey: "file", maxBytes: 5 * 1024 * 1024, fields: ["caseId", "guestThreadId"] },
  "action.54072c2407a11cc75bd91fe7": { kind: "payroll", fileKey: "paystub_file", maxBytes: 10 * 1024 * 1024, fields: ["payroll_run_id", "staff_id", "return_to"] },
  "action.805ee4ab28a6954dd0389212": { kind: "tax", fileKey: "paystub_file", maxBytes: 10 * 1024 * 1024, fields: ["payroll_run_id", "staff_id", "tax_salon_id"] },
  "action.ee11d447d1154d3e1ff376fb": { kind: "creative", fileKey: "image", maxBytes: 5 * 1024 * 1024, fields: ["id","title","caption"] },
  "action.0b1e0a58e14816ae5b2c1e9a": { kind: "pos-group", fileKey: posFiles[0], fileKeys: posFiles, maxBytes: 15 * 1024 * 1024, fields: posFields },
  "action.0eda261451682b1c1ea01f54": { kind: "pos-settings", fileKey: posFiles[0], fileKeys: posFiles, maxBytes: 15 * 1024 * 1024, fields: posFields },
} as const;
export type AppLocalFileAction = keyof typeof APP_LOCAL_FILE_ACTIONS;
export const APP_LOCAL_UPLOAD_COMMANDS = {
  "upload.prepare": { argumentKeys: ["action", "fields", "file", "files"] },
  "upload.finalize": { argumentKeys: ["sessionId"] },
  "upload.status": { argumentKeys: ["sessionId"] },
  "upload.cancel": { argumentKeys: ["sessionId"] },
} as const;
export const APP_LOCAL_UPLOAD_BUCKET = "app-local-upload-stage";
export const APP_LOCAL_UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type AppLocalUploadDescriptor = { name: string; type: string; size: number; sha256: string };
export type AppLocalUploadFileDescriptor = AppLocalUploadDescriptor & { key: string };
export type AppLocalUploadResult = { value?: unknown; redirect?: string };
export type AppLocalPreparedUpload = { sessionId: string; uploadUrl: string; expiresAt: number; files?: {key:string;uploadUrl:string}[] };
export function appLocalUploadFileKeys(action: AppLocalFileAction): readonly string[] { const rule=APP_LOCAL_FILE_ACTIONS[action];return "fileKeys" in rule?rule.fileKeys:[rule.fileKey]; }
export function appLocalUploadAllowsType(action: AppLocalFileAction,type: string) { return validAppLocalUploadType(type) && (!APP_LOCAL_FILE_ACTIONS[action].kind.startsWith("pos-")&&APP_LOCAL_FILE_ACTIONS[action].kind!=="creative"||type!=="application/pdf"); }
export function isAppLocalFileAction(name: string): name is AppLocalFileAction { return Object.hasOwn(APP_LOCAL_FILE_ACTIONS, name); }
export function validAppLocalUploadType(type: string) { return (APP_LOCAL_UPLOAD_TYPES as readonly string[]).includes(type); }
