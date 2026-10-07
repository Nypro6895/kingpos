/* eslint-disable @next/next/no-img-element -- Preserve uploaded GIF animations. */
"use client";
import { useState, type FormEvent } from "react";
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
    if (closeButton) data.set("closeButton", "on");
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
        const upload = await campaignImageUploadAction(file.type, file.size);
        const client = createSupabaseBrowserClient();
        if (!client) throw new Error("Image upload is unavailable.");
        const { error } = await client.storage
          .from("explore-advertising")
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: file.type,
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
      onSaved(parseCampaign(data));
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
                checked={closeButton}
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
          <button className={styles.primary} disabled={pending}>
            {pending ? "Saving…" : "Save campaign"}
          </button>
          <button type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
