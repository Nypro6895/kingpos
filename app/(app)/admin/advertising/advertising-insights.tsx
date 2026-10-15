"use client";
import { useState, type FormEvent } from "react";
import type { Campaign } from "@/types/explore-advertising";
import {
  DEFAULT_ADVERTISING_LIMITS,
  type AdvertisingLimits,
  type AdvertisingReportRow,
} from "@/types/advertising-report";
import { saveAdvertisingLimitsAction } from "./actions";
import styles from "./advertising.module.css";
export function AdvertisingInsights({
  campaigns,
  rows,
  limits = DEFAULT_ADVERTISING_LIMITS,
}: {
  campaigns: Campaign[];
  rows: AdvertisingReportRow[];
  limits?: AdvertisingLimits;
}) {
  const [days, setDays] = useState(30);
  const [device, setDevice] = useState("all");
  const [audience, setAudience] = useState("all");
  const [values, setValues] = useState(limits);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(new Date());
  const cutoff = new Date(today + "T12:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
  const filtered = rows.filter(
    (row) =>
      row.day >= cutoff.toISOString().slice(0, 10) &&
      (device === "all" || row.device === device) &&
      (audience === "all" || row.audience === audience),
  );
  const aggregate = new Map<
    string,
    { views: number; clicks: number; signups: number }
  >();
  for (const row of filtered) {
    const current = aggregate.get(row.campaign_id) ?? {
      views: 0,
      clicks: 0,
      signups: 0,
    };
    for (const key of ["views", "clicks", "signups"] as const)
      current[key] += Number(row[key]);
    aggregate.set(row.campaign_id, current);
  }
  const totals = [...aggregate.values()].reduce(
    (sum, item) => ({
      views: sum.views + item.views,
      clicks: sum.clicks + item.clicks,
      signups: sum.signups + item.signups,
    }),
    { views: 0, clicks: 0, signups: 0 },
  );
  const rate = (value: number, total: number) =>
    total ? ((value / total) * 100).toFixed(1) + "%" : "—";
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const form = new FormData();
      for (const [key, value] of Object.entries(values))
        form.set(key, String(value));
      const result = await saveAdvertisingLimitsAction(form);
      setMessage(result.message);
    } catch {
      setMessage("Settings could not be saved. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section>
      <h2 className={styles.sectionTitle}>Performance</h2>
      <div className={styles.previewControls}>
        <label>
          Period
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 30, 90].map((value) => (
              <option key={value} value={value}>
                Last {value} days
              </option>
            ))}
          </select>
        </label>
        <label>
          Device
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="all">All devices</option>
            <option>mobile</option>
            <option>desktop</option>
          </select>
        </label>
        <label>
          Audience
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          >
            {["all", "guest", "personal", "staff", "owner"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.metrics}>
        {[
          ["Views", totals.views],
          ["Clicks", totals.clicks],
          ["New accounts", totals.signups],
          ["Click rate", rate(totals.clicks, totals.views)],
          ["Signup / click", rate(totals.signups, totals.clicks)],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className={styles.metricHelp}>
        Views and clicks count once per campaign per browsing session. New
        accounts use the last advertising click within 7 days. Existing-account
        logins are excluded. Events are attributed to the original view date, in
        Chicago time.
      </p>
      <div className={styles.reportScroll}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Views</th>
              <th>Clicks</th>
              <th>CTR</th>
              <th>New accounts</th>
              <th>Signup / click</th>
            </tr>
          </thead>
          <tbody>
            {[...aggregate]
              .sort((a, b) => b[1].views - a[1].views)
              .map(([id, item]) => (
                <tr key={id}>
                  <td>
                    {campaigns.find((c) => c.id === id)?.name ??
                      rows.find((row) => row.campaign_id === id)
                        ?.campaign_name ??
                      `Archived campaign ${id.slice(0, 8)}`}
                  </td>
                  <td>{item.views}</td>
                  <td>{item.clicks}</td>
                  <td>{rate(item.clicks, item.views)}</td>
                  <td>{item.signups}</td>
                  <td>{rate(item.signups, item.clicks)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!filtered.length ? (
        <p className={styles.notice}>
          No tracked activity in this period. Campaign activity will appear here
          after visitors see or click an ad.
        </p>
      ) : null}
      <h2 className={styles.sectionTitle}>Session limits</h2>
      <p className={styles.metricHelp}>
        Shared across tabs and page navigation in the same browser. Set total or
        popup limit to 0 to disable that delivery. Changes apply to new
        impression requests.
      </p>
      <form onSubmit={save}>
        <fieldset disabled={pending} className={styles.fields}>
          {(
            [
              ["maxTotal", "Maximum campaigns per session", 0, 30],
              ["maxPopups", "Maximum popups per session", 0, 10],
              [
                "minPopupGapSeconds",
                "Minimum gap between popups (seconds)",
                8,
                3600,
              ],
              [
                "sessionMinutes",
                "Session inactivity timeout (minutes)",
                5,
                120,
              ],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key} className={styles.field}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                step="1"
                value={values[key]}
                onChange={(e) =>
                  setValues((current) => ({
                    ...current,
                    [key]: Number(e.target.value),
                  }))
                }
              />
            </label>
          ))}
        </fieldset>
        <div className={styles.footer}>
          <button className={styles.primary} disabled={pending}>
            {pending ? "Saving…" : "Save session limits"}
          </button>
          <p role="status">{message}</p>
        </div>
      </form>
    </section>
  );
}
