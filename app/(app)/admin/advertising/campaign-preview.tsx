"use client";
import { useState } from "react";
import type { Campaign, CampaignAudience } from "@/types/explore-advertising";
import { campaignMatches } from "@/lib/explore-advertising-rules";
import { ImageAd } from "@/components/explore-advertising";
import styles from "./advertising.module.css";
export function CampaignPreview({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">(
    (campaign.devices ?? ["mobile", "desktop"]).includes("mobile")
      ? "mobile"
      : "desktop",
  );
  const [audience, setAudience] = useState<CampaignAudience>(
    campaign.audiences?.[0] ?? "guest",
  );
  const [path, setPath] = useState(campaign.locations?.[0] ?? "/explore");
  const [position, setPosition] = useState<string>(
    (campaign.placements ?? ["sidebar", "feed"]).find((value) =>
      device === "mobile" ? value !== "sidebar" : value !== "feed",
    ) ?? (campaign.placements ?? ["sidebar", "feed"])[0],
  );
  const usablePosition = position !== "sidebar" || device === "desktop";
  const feedPosition =
    position !== "feed" || (device === "mobile" && path.startsWith("/explore"));
  const matches =
    campaignMatches(campaign, path, audience, device) &&
    (campaign.kind !== "placement" || (usablePosition && feedPosition));
  return (
    <section className={styles.previewPanel} aria-label="Campaign preview">
      <div className={styles.editorHeading}>
        <div>
          <h2>Preview · {campaign.name}</h2>
          <p>Preview only. No impressions, clicks or signups are recorded.</p>
        </div>
        <button type="button" onClick={onClose}>
          Close preview
        </button>
      </div>
      <div className={styles.previewControls}>
        <label>
          Device
          <select
            value={device}
            onChange={(e) => {
              const next = e.target.value as typeof device;
              setDevice(next);
              if (campaign.kind === "placement") {
                const nextPosition = (
                  campaign.placements ?? ["sidebar", "feed"]
                ).find((value) =>
                  next === "mobile" ? value !== "sidebar" : value !== "feed",
                );
                if (nextPosition) setPosition(nextPosition);
              }
            }}
          >
            <option value="mobile">Mobile / PWA</option>
            <option value="desktop">Desktop</option>
          </select>
        </label>
        <label>
          Audience
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as CampaignAudience)}
          >
            {["guest", "personal", "staff", "owner"].map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        {campaign.kind === "placement" ? (
          <label>
            Position
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              {(campaign.placements ?? ["sidebar", "feed"]).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Page
          <input value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
      </div>
      <p role="status">
        {matches
          ? "Matches the selected audience, device and page."
          : "This campaign will not appear for this selection."}
      </p>
      <div className={styles.previewViewportWrap}>
        <div
          className={styles.previewViewport}
          style={{
            width: device === "mobile" ? 390 : 1000,
            maxWidth: device === "mobile" ? "100%" : undefined,
            height: device === "mobile" ? 650 : 450,
          }}
        >
          <div
            className={styles.previewNav}
            style={
              matches &&
              campaign.kind === "ticker" &&
              (device === "mobile" || campaign.position === "top")
                ? { paddingTop: 58 }
                : undefined
            }
          >
            Reylumi{" "}
            <span>
              {audience} · {path}
            </span>
          </div>
          {matches && campaign.kind === "ticker" ? (
            <div
              className={styles.previewTicker}
              style={{
                background: campaign.background,
                color: campaign.color,
                top:
                  device === "mobile" || campaign.position === "top"
                    ? 0
                    : undefined,
                bottom:
                  device === "desktop" && campaign.position === "bottom"
                    ? 0
                    : undefined,
              }}
            >
              <span style={{ animationDuration: campaign.speedSeconds + "s" }}>
                {campaign.text || campaign.name}
              </span>
              {campaign.closeButton ? <b>×</b> : null}
            </div>
          ) : null}
          <div className={styles.previewContent}>
            <h3>
              {path.startsWith("/explore")
                ? "Explore beauty near you"
                : "Your workspace"}
            </h3>
            <p>Discover inspiration and updates.</p>
            {matches &&
            campaign.kind === "placement" &&
            (position === "page-top" || position === "sidebar") ? (
              <div
                style={{ maxWidth: position === "sidebar" ? 220 : undefined }}
              >
                <ImageAd campaign={campaign} preview />
              </div>
            ) : null}
            <div className={styles.sampleContent}>A moment of inspiration</div>
            {matches && campaign.kind === "placement" && position === "feed" ? (
              <ImageAd campaign={campaign} preview />
            ) : null}
            <div className={styles.sampleContent}>Your next discovery</div>
            {matches &&
            campaign.kind === "placement" &&
            position === "page-bottom" ? (
              <ImageAd campaign={campaign} preview />
            ) : null}
          </div>
          {matches && campaign.kind === "popup" ? (
            <div className={styles.previewBackdrop}>
              <div className={styles.previewPopup}>
                <ImageAd campaign={campaign} preview />
                {campaign.closeButton ? (
                  <b className={styles.previewClose}>×</b>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <p>
        {campaign.kind === "popup"
          ? `Trigger: ${campaign.popupTrigger === "scroll" ? `${campaign.scrollPercent ?? 35}% scroll` : `after ${campaign.delaySeconds}s`}.`
          : campaign.kind === "ticker"
            ? "On mobile, this announcement appears at the top before popups."
            : "Mobile feed entries do not repeat in the same visit."}{" "}
        {campaign.durationSeconds
          ? `Duration: ${campaign.durationSeconds}s.`
          : "Visible until closed or page exit."}
      </p>
    </section>
  );
}
