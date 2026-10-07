/* eslint-disable @next/next/no-img-element -- Preserve uploaded GIF animation and intrinsic campaign dimensions. */
"use client";
import { useActionState, useState } from "react";
import {
  saveCampaignAction,
  deleteCampaignAction,
  campaignImageUploadAction,
} from "./actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Campaign } from "@/types/explore-advertising";
const input = "w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm";
export function CampaignForm({ campaign }: { campaign?: Campaign }) {
  const [state, action, pending] = useActionState(
    async (
      previous: { ok: boolean; message: string; id?: string },
      form: FormData,
    ) => {
      try {
        const file = form.get("image");
        if (file instanceof File && file.size) {
          const upload = await campaignImageUploadAction(file.type, file.size);
          const client = createSupabaseBrowserClient();
          if (!client) throw new Error("Image upload is unavailable.");
          const { error } = await client.storage
            .from("explore-advertising")
            .uploadToSignedUrl(upload.path, upload.token, file, {
              contentType: file.type,
            });
          if (error) throw new Error("Image upload failed. Please try again.");
          form.set("imageUrl", upload.url);
          form.delete("image");
        }
        return await saveCampaignAction(previous, form);
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "Unable to save campaign.",
          id: previous.id,
        };
      }
    },
    { ok: false, message: "", id: campaign?.id ?? "" },
  );
  const [kind, setKind] = useState(campaign?.kind ?? "popup");
  const [image, setImage] = useState(campaign?.imageUrl ?? "");
  const date = (value?: string | null) =>
    value ? new Date(value).toISOString().slice(0, 16) : "";
  return (
    <details className="rounded-2xl border bg-white p-5" open={!campaign}>
      <summary className="cursor-pointer font-semibold">
        {campaign
          ? `${campaign.name} · ${campaign.kind} · ${campaign.enabled ? "On" : "Off"}`
          : "Create campaign"}
      </summary>
      <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={campaign?.id ?? state.id ?? ""} />
        <label>
          Name
          <input
            className={input}
            name="name"
            required
            defaultValue={campaign?.name}
          />
        </label>
        <label>
          Format
          <select
            className={input}
            name="kind"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as Campaign["kind"])
            }
          >
            <option value="popup">Popup</option>
            <option value="placement">Desktop sidebar / mobile feed</option>
            <option value="ticker">Scrolling announcement</option>
          </select>
        </label>
        <label className="sm:col-span-2">
          Click destination
          <input
            className={input}
            name="href"
            required
            placeholder="https://… or /explore/…"
            defaultValue={campaign?.href}
          />
        </label>
        <label className={kind === "ticker" ? "hidden" : ""}>
          Image URL
          <input
            className={input}
            name="imageUrl"
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className={kind === "ticker" ? "hidden" : ""}>
          Upload image / animated GIF
          <input
            className={input}
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
          />
          <span className="text-xs text-zinc-500">
            Up to 10 MB. Uploaded image replaces the URL.
          </span>
        </label>
        {image &&
        image !== "/advertising-upload-pending" &&
        kind !== "ticker" ? (
          <div className="sm:col-span-2">
            <img
              src={image}
              alt="Campaign preview"
              className="max-h-60 rounded-xl object-contain"
            />
          </div>
        ) : null}
        <label className={kind === "ticker" ? "sm:col-span-2" : "hidden"}>
          Announcement
          <textarea
            className={input}
            name="text"
            maxLength={1000}
            defaultValue={campaign?.text}
          />
        </label>
        <label>
          Start (UTC)
          <input
            className={input}
            name="startsAt"
            type="datetime-local"
            defaultValue={date(campaign?.startsAt)}
          />
        </label>
        <label>
          End (UTC)
          <input
            className={input}
            name="endsAt"
            type="datetime-local"
            defaultValue={date(campaign?.endsAt)}
          />
        </label>
        <label>
          Delay after arrival (seconds)
          <input
            className={input}
            name="delaySeconds"
            type="number"
            min={0}
            max={3600}
            defaultValue={campaign?.delaySeconds ?? 5}
          />
        </label>
        <label>
          Visible duration (seconds; 0 = until closed / page exit)
          <input
            className={input}
            name="durationSeconds"
            type="number"
            min={0}
            max={3600}
            defaultValue={campaign?.durationSeconds ?? 15}
          />
        </label>
        <label>
          Popup frequency per IP
          <select
            className={input}
            name="repeat"
            defaultValue={campaign?.repeat ?? "daily"}
          >
            <option value="always">Every visit</option>
            <option value="once">Only once</option>
            <option value="daily">Again tomorrow (Chicago time)</option>
          </select>
        </label>
        <label>
          Announcement position
          <select
            className={input}
            name="position"
            defaultValue={campaign?.position ?? "top"}
          >
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
        <label>
          Background
          <input
            className={input}
            name="background"
            type="color"
            defaultValue={campaign?.background ?? "#fff0e8"}
          />
        </label>
        <label>
          Text color
          <input
            className={input}
            name="color"
            type="color"
            defaultValue={campaign?.color ?? "#302326"}
          />
        </label>
        <label>
          Scroll cycle (seconds; higher = slower)
          <input
            className={input}
            name="speedSeconds"
            type="number"
            min={5}
            max={300}
            defaultValue={campaign?.speedSeconds ?? 25}
          />
        </label>
        <div className="flex items-center gap-5">
          <label>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={campaign?.enabled ?? false}
            />{" "}
            Run campaign
          </label>
          <label>
            <input
              type="checkbox"
              name="closeButton"
              defaultChecked={campaign?.closeButton ?? true}
            />{" "}
            Show close button
          </label>
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            disabled={pending}
            className="rounded-xl bg-zinc-950 px-5 py-3 text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save campaign"}
          </button>
          <span
            role="status"
            className={state.ok ? "text-green-700" : "text-red-700"}
          >
            {state.message}
          </span>
        </div>
      </form>
      {campaign ? (
        <form
          action={deleteCampaignAction}
          className="mt-4"
          onSubmit={(event) => {
            if (!confirm("Delete this campaign?")) event.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={campaign.id} />
          <button className="text-sm text-red-700">Delete campaign</button>
        </form>
      ) : null}
    </details>
  );
}
