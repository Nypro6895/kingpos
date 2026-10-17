"use client";
import { prepareImageUpload } from "@/lib/image-upload-client";
import { CampaignPreview } from "./campaign-preview";
/* eslint-disable @next/next/no-img-element -- Preserve uploaded GIF animations. */
import { useState, useEffect, type FormEvent } from "react";
import { saveCampaignAction, campaignImageUploadAction } from "./actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  parseCampaign,
  CampaignValidationError,
  campaignStatus,
} from "@/lib/explore-advertising-rules";
import type { Campaign } from "@/types/explore-advertising";
import styles from "./advertising.module.css";

export function CampaignForm({
  campaign,
  onSaved,
  onCancel,
}: {
  campaign?: Campaign;
  onSaved: (campaign: Campaign) => void;
  onCancel: () => void;
}) {
  const date = (value?: string | null) =>
    value ? new Date(value).toISOString().slice(0, 16) : "";
  const [values, setValues] = useState<Record<string, string>>(() => ({
    audiences: (
      campaign?.audiences ?? ["guest", "personal", "staff", "owner"]
    ).join(","),
    devices: (campaign?.devices ?? ["desktop", "mobile"]).join(","),
    placements: (campaign?.placements ?? ["sidebar", "feed"]).join(","),
    locations: (campaign?.locations ?? ["/explore"]).join("\n"),
    popupTrigger: campaign?.popupTrigger ?? "delay",
    scrollPercent: String(campaign?.scrollPercent ?? 35),
    id: campaign?.id ?? "",
    name: campaign?.name ?? "",
    kind: campaign?.kind ?? "popup",
    status: campaign ? campaignStatus(campaign) : "draft",
    imageUrl: campaign?.imageUrl ?? "",
    href: campaign?.href ?? "",
    text: campaign?.text ?? "",
    startsAt: date(campaign?.startsAt),
    endsAt: date(campaign?.endsAt),
    delaySeconds: String(campaign?.delaySeconds ?? 5),
    durationSeconds: String(campaign?.durationSeconds ?? 15),
    repeat: campaign?.repeat ?? "daily",
    position: campaign?.position ?? "top",
    background: campaign?.background ?? "#fff0e8",
    color: campaign?.color ?? "#302326",
    speedSeconds: String(campaign?.speedSeconds ?? 25),
  }));
  const [closeButton, setCloseButton] = useState(campaign?.closeButton ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  useEffect(
    () => () => {
      if (previewCampaign?.imageUrl.startsWith("blob:"))
        URL.revokeObjectURL(previewCampaign.imageUrl);
    },
    [previewCampaign],
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const change = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };
  const control = (
    key: string,
    label: string,
    type = "text",
    options?: [string, string][],
  ) => (
    <label className={styles.field}>
      {label}
      {options ? (
        <select
          aria-label={label}
          name={key}
          value={values[key]}
          onChange={(e) => change(key, e.target.value)}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
        >
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          aria-label={label}
          name={key}
          value={values[key]}
          onChange={(e) => change(key, e.target.value)}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
        />
      ) : (
        <input
          aria-label={label}
          name={key}
          type={type}
          value={values[key]}
          onChange={(e) => change(key, e.target.value)}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
        />
      )}{" "}
      {errors[key] ? (
        <span id={`${key}-error`} className={styles.error}>
          {errors[key]}
        </span>
      ) : null}
    </label>
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    setPending(true);
    setErrors({});
    setMessage("");
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    if (!values.id) {
      const id = crypto.randomUUID();
      data.set("id", id);
      change("id", id);
    }
    if (closeButton || values.kind === "popup") data.set("closeButton", "on");
    if (values.kind === "ticker") data.set("imageUrl", "");
    else if (file) data.set("imageUrl", "/advertising-upload-pending");
    try {
      // Validate before uploading; never reset inputs after a failed action.
      parseCampaign(data);
      if (file && values.kind !== "ticker") {
        if (
          !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
            file.type,
          ) ||
          file.size > 10485760 ||
          !file.size
        )
          throw new CampaignValidationError({
            image: "Choose a JPG, PNG, WebP or GIF under 10 MB.",
          });
        const prepared = await prepareImageUpload(file);
        const upload = await campaignImageUploadAction(prepared.type, prepared.size);
        const client = createSupabaseBrowserClient();
        if (!client) throw new Error("Image upload is unavailable.");
        const { error } = await client.storage
          .from("explore-advertising")
          .uploadToSignedUrl(upload.path, upload.token, prepared, {
            contentType: prepared.type,
          });
        if (error) throw new Error("Image upload failed. Please try again.");
        data.set("imageUrl", upload.url);
        change("imageUrl", upload.url);
        setFile(null);
      }
      const result = await saveCampaignAction(
        { ok: false, message: "", id: values.id },
        data,
      );
      if (!result.ok) {
        setErrors(result.errors ?? {});
        setMessage(result.message);
        return;
      }
      data.set("id", result.id!);
      onSaved(result.campaign ?? parseCampaign(data));
    } catch (error) {
      if (error instanceof CampaignValidationError) setErrors(error.fields);
      setMessage(
        error instanceof Error ? error.message : "Unable to save campaign.",
      );
      if (error instanceof CampaignValidationError) {
        const key = Object.keys(error.fields)[0];
        (element.elements.namedItem(key) as HTMLElement | null)?.focus();
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={styles.editor}>
      <div className={styles.editorHeading}>
        <div>
          <h2>{campaign ? "Edit campaign" : "Create campaign"}</h2>
          <p>Images and links are optional. Use text, an image, or both.</p>
        </div>
        <button type="button" onClick={onCancel} disabled={pending}>
          Back to list
        </button>
      </div>
      <form onSubmit={submit} noValidate className={styles.form}>
        <fieldset disabled={pending} className={styles.fields}>
          {control("name", "Campaign name")}
          {control("kind", "Format", "select", [
            ["popup", "Popup"],
            ["placement", "Desktop sidebar / mobile feed"],
            ["ticker", "Scrolling announcement"],
          ])}
          {control("status", "Status", "select", [
            ["draft", "Saved draft"],
            ["running", "Running"],
            ["stopped", "Stopped"],
          ])}
          <div className={styles.full}>
            <h3>Audience & locations</h3>
            <p>
              Choose multiple workspaces, devices and pages. A page path also
              includes its subpages.
            </p>
          </div>
          {(
            [
              [
                "audiences",
                "Show to",
                [
                  ["guest", "Guest"],
                  ["personal", "Personal"],
                  ["staff", "Staff"],
                  ["owner", "Owner"],
                ],
              ],
              [
                "devices",
                "Devices",
                [
                  ["desktop", "Desktop"],
                  ["mobile", "Mobile / app"],
                ],
              ],
              [
                "placements",
                "Placement positions",
                [
                  ["sidebar", "Desktop sidebar"],
                  ["feed", "Explore mobile feed"],
                  ["page-top", "Page start"],
                  ["page-bottom", "Page end"],
                ],
              ],
            ] as [string, string, [string, string][]][]
          ).map(([key, label, options]) => (
            <fieldset key={key} className={styles.targetGroup}>
              <legend>{label}</legend>
              {options.map(([value, text]) => (
                <label key={value} className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={values[key].split(",").includes(value)}
                    onChange={(e) => {
                      const selected = values[key]
                        .split(",")
                        .filter(Boolean)
                        .filter((item) => item !== value);
                      if (e.target.checked) selected.push(value);
                      change(key, selected.join(","));
                    }}
                  />
                  {text}
                </label>
              ))}
              {errors[key] ? (
                <span className={styles.error}>{errors[key]}</span>
              ) : null}
            </fieldset>
          ))}
          <div className={styles.full}>
            {control(
              "locations",
              "Page locations (one path per line)",
              "textarea",
            )}
            <p>
              Examples: /explore, /staff, /bookings, /beauty, /notifications.
              Use / for all pages. Admin pages are excluded.
            </p>
            <div className={styles.locationPresets}>
              {[
                "/explore",
                "/staff",
                "/bookings",
                "/salon-profile",
                "/beauty",
                "/my-bookings",
                "/notifications",
                "/more",
              ].map((path) => (
                <button
                  type="button"
                  key={path}
                  onClick={() =>
                    change(
                      "locations",
                      [
                        ...new Set([
                          ...values.locations.split(/[\n,]+/).filter(Boolean),
                          path,
                        ]),
                      ].join("\n"),
                    )
                  }
                >
                  + {path}
                </button>
              ))}
            </div>
          </div>
          {values.kind === "popup" ? (
            <>
              {control("popupTrigger", "Popup stage", "select", [
                ["delay", "After arrival delay"],
                ["scroll", "After scrolling"],
              ])}
              {values.popupTrigger === "scroll"
                ? control("scrollPercent", "Scroll progress (%)", "number")
                : null}
              <p>
                On mobile, announcements appear first. Popups wait at least 8
                seconds after an announcement.
              </p>
            </>
          ) : null}
          {control("href", "Click destination (optional)")}
          {values.kind !== "ticker" ? (
            <>
              {control("imageUrl", "Image URL (optional)")}
              <label className={styles.field}>
                Upload image / GIF (optional)
                <input
                  name="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <span>JPG, PNG, WebP or GIF, up to 10 MB. {file?.name}</span>
                {errors.image ? (
                  <span className={styles.error}>{errors.image}</span>
                ) : null}
              </label>
            </>
          ) : null}
          <div className={styles.full}>
            {control(
              "text",
              values.kind === "ticker"
                ? "Announcement text"
                : "Message (optional)",
              "textarea",
            )}
          </div>
          {values.imageUrl && values.kind !== "ticker" ? (
            <img
              src={values.imageUrl}
              alt="Campaign preview"
              className={styles.preview}
            />
          ) : null}
          {control("startsAt", "Start (UTC)", "datetime-local")}
          {control("endsAt", "End (UTC)", "datetime-local")}
          {control("delaySeconds", "Delay after arrival (seconds)", "number")}
          {control(
            "durationSeconds",
            "Visible duration (seconds; 0 = unlimited)",
            "number",
          )}
          {values.kind === "popup"
            ? control("repeat", "Frequency per IP", "select", [
                ["always", "Every visit"],
                ["once", "Only once"],
                ["daily", "Again tomorrow (Chicago time)"],
              ])
            : null}
          {values.kind === "ticker" ? (
            <>
              {control("position", "Position", "select", [
                ["top", "Top"],
                ["bottom", "Bottom"],
              ])}
              {control(
                "speedSeconds",
                "Scroll cycle (seconds; higher = slower)",
                "number",
              )}
            </>
          ) : null}
          {control("background", "Background", "color")}
          {control("color", "Text color", "color")}
          {values.kind !== "placement" ? (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={values.kind === "popup" || closeButton}
                disabled={values.kind === "popup"}
                onChange={(e) => setCloseButton(e.target.checked)}
              />
              Show close button
            </label>
          ) : null}
        </fieldset>
        {message ? (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        ) : null}
        <div className={styles.footer}>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              try {
                const form = new FormData();
                for (const [key, value] of Object.entries(values))
                  form.set(key, value);
                form.set("name", values.name || "Campaign preview");
                form.set("status", "draft");
                if (closeButton || values.kind === "popup") form.set("closeButton", "on");
                if (file) form.set("imageUrl", "");
                const preview = parseCampaign(form);
                if (file) preview.imageUrl = URL.createObjectURL(file);
                setPreviewCampaign(preview);
              } catch (error) {
                if (error instanceof CampaignValidationError)
                  setErrors(error.fields);
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Cannot preview campaign.",
                );
              }
            }}
          >
            Preview draft
          </button>
          <button className={styles.primary} disabled={pending}>
            {pending ? "Saving…" : "Save campaign"}
          </button>
          <button type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
      {previewCampaign ? (
        <CampaignPreview
          campaign={previewCampaign}
          onClose={() => setPreviewCampaign(null)}
        />
      ) : null}
    </section>
  );
}
