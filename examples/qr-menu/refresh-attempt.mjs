export function retryAttemptIsLive(record,instant) {
  const attempt=record.refreshAttempt;
  return Boolean(attempt && /^[a-f0-9-]{36}$/i.test(attempt.id??"") && /^rmk_[A-Za-z0-9_-]{43}$/.test(attempt.key??"") && Number.isFinite(attempt.startedAt) && instant>=attempt.startedAt && instant-attempt.startedAt<90000);
}
