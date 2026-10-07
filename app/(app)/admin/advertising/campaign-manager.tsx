/* eslint-disable @next/next/no-img-element -- Campaign thumbnail preserves GIF animations. */
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Campaign } from "@/types/explore-advertising";
import { campaignStatus } from "@/lib/explore-advertising-rules";
import { CampaignForm } from "./campaign-form";
import { saveCampaignAction, deleteCampaignAction } from "./actions";
import styles from "./advertising.module.css";
const tabs = [
  ["running", "Running"],
  ["draft", "Saved"],
  ["stopped", "Stopped"],
  ["new", "Create new"],
] as const;
const formats = {
  popup: "Popup",
  placement: "Sidebar / feed",
  ticker: "Announcement",
};
export function CampaignManager({
  initialCampaigns,
  error,
}: {
  initialCampaigns: Campaign[];
  error: string;
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [tab, setTab] = useState<string>("running");
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState(error);
  const merge = (campaign: Campaign) => {
    setCampaigns((current) => [
      campaign,
      ...current.filter((item) => item.id !== campaign.id),
    ]);
    setEditing(null);
    setTab(campaignStatus(campaign));
    setVersion((current) => current + 1);
    setNotice("Campaign saved.");
    router.refresh();
  };
  async function updateStatus(
    campaign: Campaign,
    status: NonNullable<Campaign["status"]>,
  ) {
    setBusy(campaign.id);
    setNotice("");
    const form = new FormData();
    for (const [key, value] of Object.entries(campaign))
      if (value !== null && value !== undefined && typeof value !== "boolean")
        form.set(key, String(value));
    form.set("status", status);
    if (campaign.closeButton) form.set("closeButton", "on");
    try {
      const result = await saveCampaignAction(
        { ok: false, message: "", id: campaign.id },
        form,
      );
      if (!result.ok) throw new Error(result.message);
      merge({ ...campaign, status, enabled: status === "running" });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to update campaign.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function remove(campaign: Campaign) {
    if (!confirm(`Delete “${campaign.name}”?`)) return;
    setBusy(campaign.id);
    try {
      const form = new FormData();
      form.set("id", campaign.id);
      await deleteCampaignAction(form);
      setCampaigns((current) =>
        current.filter((item) => item.id !== campaign.id),
      );
      setNotice("Campaign deleted.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to delete campaign.",
      );
    } finally {
      setBusy(null);
    }
  }
  const visible = campaigns.filter(
    (campaign) => campaignStatus(campaign) === tab,
  );
  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>EXPLORE</span>
          <h1>Advertising</h1>
          <p>
            Manage your campaigns, placements and announcements in one place.
          </p>
        </div>
        <button
          className={styles.primary}
          onClick={() => {
            setEditing(null);
            setVersion((v) => v + 1);
            setTab("new");
            setNotice("");
          }}
        >
          + Create campaign
        </button>
      </header>
      <nav className={styles.tabs} aria-label="Campaign status">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => {
              setEditing(null);
              setTab(key);
              if (key === "new") setVersion((v) => v + 1);
              setNotice("");
            }}
          >
            {label}
            {key !== "new" ? (
              <span>
                {campaigns.filter((c) => campaignStatus(c) === key).length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      {tab === "new" || editing ? (
        <CampaignForm
          key={editing?.id ?? `new-${version}`}
          campaign={editing ?? undefined}
          onSaved={merge}
          onCancel={() => {
            setEditing(null);
            if (tab === "new") setTab("draft");
          }}
        />
      ) : (
        <>
          <div className={styles.listHeader}>
            <span>
              {visible.length} campaign{visible.length === 1 ? "" : "s"}
            </span>
            <span>Campaign · Format · Schedule · Actions</span>
          </div>
          {visible.length ? (
            <div className={styles.list}>
              {visible.map((campaign) => (
                <article key={campaign.id} className={styles.row}>
                  <div className={styles.thumbnail}>
                    {campaign.imageUrl ? (
                      <img src={campaign.imageUrl} alt="" />
                    ) : (
                      <span>{campaign.kind === "ticker" ? "Aa" : "✦"}</span>
                    )}
                  </div>
                  <div className={styles.identity}>
                    <h2>{campaign.name}</h2>
                    <p>{campaign.text || "No message added"}</p>
                    <span>{formats[campaign.kind]}</span>
                  </div>
                  <div className={styles.schedule}>
                    {campaign.startsAt
                      ? `From ${new Date(campaign.startsAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}`
                      : "No start restriction"}
                    <small>
                      {campaign.endsAt
                        ? `Until ${new Date(campaign.endsAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}`
                        : "No end restriction"}{" "}
                      · Chicago time
                    </small>
                  </div>
                  <div className={styles.actions}>
                    <button
                      disabled={busy === campaign.id}
                      onClick={() => {
                        setEditing(campaign);
                        setNotice("");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy === campaign.id}
                      onClick={() =>
                        updateStatus(
                          campaign,
                          campaign.enabled ? "stopped" : "running",
                        )
                      }
                    >
                      {busy === campaign.id
                        ? "Working…"
                        : campaign.enabled
                          ? "Stop"
                          : "Run"}
                    </button>
                    <button
                      className={styles.delete}
                      disabled={busy === campaign.id}
                      onClick={() => remove(campaign)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <span>✦</span>
              <h2>
                No {tabs.find(([key]) => key === tab)?.[1].toLowerCase()}{" "}
                campaigns yet
              </h2>
              <p>
                Create a campaign, save it for later, or start it when you are
                ready.
              </p>
              <button
                onClick={() => {
                  setTab("new");
                  setVersion((v) => v + 1);
                }}
              >
                Create your first campaign →
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
