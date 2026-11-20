/* eslint-disable @next/next/no-img-element -- Existing salon-owned public previews; runtime app images use the authenticated metadata-stripping gateway. */
"use client";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { savePublication } from "./actions";
import { PublicationComparison } from "./comparison";
import {
  publicGroups,
  publicGroupLabels,
  emptyPublicData,
  priceDigits,
  parsePublicPrice,
  publicPriceInput,
  type PublicGroup,
  type PublicData,
  type PublicationWorkspace,
  type PublicProfile,
  type PublicService,
  type PublicPhoto,
  type PublicEntry,
} from "@/lib/market-platform/published-contract";
import styles from "./data.module.css";
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function PublicationEditor({
  workspace,
  initialGroup = "profile",
}: {
  workspace: PublicationWorkspace & {
    assets: { id: string; purpose: string; previewUrl?: string }[];
  };
  initialGroup?: PublicGroup;
}) {
  const [group, setGroup] = useState(initialGroup);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  const recordDirty = useCallback((value:boolean) => {dirtyRef.current=value;setDirty(value);},[]);
  const translate = useWorkspaceTranslation();
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if(dirtyRef.current) event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  return (
    <>
      <p className={styles.notice}><WorkspaceText text="These are separate public copies. Changes in POS or salon settings do not update this menu automatically. Edit and publish a new revision here to update what plugins can read." /></p>
      <nav className={styles.groupNav} aria-label="Shared data groups">
        {publicGroups.map((g) => (
          <button
            key={g}
            aria-pressed={group === g}
            disabled={busy}
            onClick={() => {
              if (g === group || busy) return;
              if (dirty && !window.confirm(translate("You have unsaved changes. Discard them and switch data groups?"))) return;
              recordDirty(false);setGroup(g);
            }}
          >
            <WorkspaceText text={publicGroupLabels[g]} />
          </button>
        ))}
      </nav>
      <GroupEditor
        key={workspace.salonId + ":" + group}
        group={group}
        workspace={workspace}
        onDirtyChange={recordDirty}
        onBusyChange={setBusy}
      />
    </>
  );
}
function GroupEditor({
  group,
  workspace,
  onDirtyChange,
  onBusyChange,
}: {
  group: PublicGroup;
  workspace: PublicationWorkspace & {
    assets: { id: string; purpose: string; previewUrl?: string }[];
  };
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const row = workspace.groups.find((g) => g.group === group);
  const translate = useWorkspaceTranslation();
  const [data, setData] = useState<PublicData[PublicGroup]>(
    row?.data ?? emptyPublicData(group),
  );
  const [state, action, pending] = useActionState(savePublication, {
    ok: false,
    message: "",
  });
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const dirty = JSON.stringify(data) !== JSON.stringify(row?.data ?? emptyPublicData(group));
  useEffect(() => { onDirtyChange(dirty && !state.ok && !state.uncertain); }, [dirty, state.ok, state.uncertain, onDirtyChange]);
  useEffect(() => { onBusyChange(Boolean(pending || state.uncertain)); }, [pending, state.uncertain, onBusyChange]);
  useEffect(() => {
    if (state.ok)
      window.location.assign("/market/data?group=" + group + "&saved=1");
  }, [state, group]);
  const profile = data as PublicProfile,
    services = (data as PublicData["services"]).services,
    images = (data as PublicData["media"]).images,
    entries = (data as PublicData["content"]).entries;
  function changeProfile(k: keyof PublicProfile, value: unknown) {
    setData({ ...profile, [k]: value });
  }
  function changeService(i: number, k: keyof PublicService, value: unknown) {
    setData({
      services: services.map((s, n) => (n === i ? { ...s, [k]: value } : s)),
    });
  }
  function changeImage(i: number, k: keyof PublicPhoto, value: unknown) {
    setData({
      images: images.map((s, n) => (n === i ? { ...s, [k]: value } : s)),
    });
  }
  function changeEntry(i: number, k: keyof PublicEntry, value: unknown) {
    setData({
      entries: entries.map((s, n) => (n === i ? { ...s, [k]: value } : s)),
    });
  }
  const text = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    max = 300,
  ) => (
    <label>
      <WorkspaceText text={label} />
      <input
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
  return (
    <section>
      <h2>
        <WorkspaceText text={publicGroupLabels[group]} />
      </h2>
      <p>
        <strong>
          <WorkspaceText text={row?.published ? "Published" : "Not shared"} />
        </strong>
        {" "}<WorkspaceText text={"· Revision "} />
        {row?.publishedRevision ?? row?.revision ?? 0}
      </p>
      {row?.hasDraft && <p role="status"><WorkspaceText text="You have unpublished changes. Plugins still read the published revision, if one is shared." /></p>}
      {row?.publishedData && <PublicationComparison group={group} live={row.publishedData} draft={data} unsaved={dirty} />}
      <p>
        <WorkspaceText
          text={
            "Saving a draft keeps the published revision online. Publishing replaces it with the exact fields below for installed apps with this permission, including public menu pages. Stop sharing immediately blocks new reads of this group."
          }
        />
      </p>
      <form action={action} onSubmit={event => { if (pending || state.uncertain || state.ok) event.preventDefault(); }}>
        <fieldset className={styles.editorFields} disabled={pending || state.uncertain || state.ok}>
        <input type="hidden" name="salon" value={workspace.salonId} />
        <input type="hidden" name="group" value={group} />
        <input type="hidden" name="revision" value={row?.revision ?? 0} />
        <input type="hidden" name="payload" value={JSON.stringify(data)} />
        {group === "profile" && (
          <>
            <div className={styles.grid}>
              {text(
                "Public salon name",
                profile.displayName,
                (v) => changeProfile("displayName", v),
                100,
              )}
              {text("Tagline", profile.tagline, (v) =>
                changeProfile("tagline", v),
              )}
              {text(
                "Business phone only",
                profile.businessPhone,
                (v) => changeProfile("businessPhone", v),
                40,
              )}
              {text(
                "Public business address only",
                profile.businessAddress,
                (v) => changeProfile("businessAddress", v),
              )}
              {text(
                "Public HTTPS website",
                profile.website,
                (v) => changeProfile("website", v),
                2048,
              )}
              {text(
                "Salon timezone",
                profile.timezone,
                (v) => changeProfile("timezone", v),
                100,
              )}
              <label>
                <WorkspaceText text={"Brand color"} />
                <input
                  type="color"
                  value={profile.brandColor}
                  onChange={(e) => changeProfile("brandColor", e.target.value)}
                />
              </label>
            </div>
            <h3>
              <WorkspaceText text={"Opening hours"} />
            </h3>
            <p>
              <WorkspaceText
                text={
                  "Same-day hours only. An omitted day is unknown, not automatically closed."
                }
              />
            </p>
            {days.map((day, n) => {
              const h = profile.hours.find((x) => x.day === n);
              const update = (next: PublicProfile["hours"][number] | null) =>
                changeProfile(
                  "hours",
                  [
                    ...profile.hours.filter((x) => x.day !== n),
                    ...(next ? [next] : []),
                  ].sort((a, b) => a.day - b.day),
                );
              return (
                <div className={styles.hours} key={day}>
                  <span>
                    <WorkspaceText text={day} />
                  </span>
                  <select
                    aria-label={translate(day) + " · " + translate("Status")}
                    value={!h ? "unknown" : h.closed ? "closed" : "open"}
                    onChange={(e) =>
                      update(
                        e.target.value === "unknown"
                          ? null
                          : {
                              day: n,
                              closed: e.target.value === "closed",
                              opens:
                                e.target.value === "closed" ? null : "09:00",
                              closes:
                                e.target.value === "closed" ? null : "18:00",
                            },
                      )
                    }
                  >
                    <option value="unknown">
                      <WorkspaceText text={"Not published"} />
                    </option>
                    <option value="closed">
                      <WorkspaceText text={"Closed"} />
                    </option>
                    <option value="open">
                      <WorkspaceText text={"Open"} />
                    </option>
                  </select>
                  {h && !h.closed && (
                    <>
                      <input
                        aria-label={translate(day) + " · " + translate("Opens")}
                        type="time"
                        value={h.opens ?? ""}
                        onChange={(e) =>
                          update({ ...h, opens: e.target.value })
                        }
                      />
                      <input
                        aria-label={translate(day) + " · " + translate("Closes")}
                        type="time"
                        value={h.closes ?? ""}
                        onChange={(e) =>
                          update({ ...h, closes: e.target.value })
                        }
                      />
                    </>
                  )}
                </div>
              );
            })}
          </>
        )}
        {group === "services" && (
          <>
            <p>
              <WorkspaceText
                text={
                  "Enter public list prices in the selected currency, for example 25.50 USD. Changing currency does not convert prices. These are not checkout quotes, tax or final totals. Unknown duration stays unknown."
                }
              />
            </p>
            {services.map((s, i) => (
              <fieldset key={s.id}>
                <legend>
                  <WorkspaceText text={"Service "} />
                  {i + 1}
                </legend>
                <div className={styles.grid}>
                  {text(
                    "Service name",
                    s.name,
                    (v) => changeService(i, "name", v),
                    100,
                  )}
                  {text(
                    "Category",
                    s.category,
                    (v) => changeService(i, "category", v),
                    100,
                  )}
                  <label>
                    <WorkspaceText text={"Price type"} />
                    <select
                      value={s.priceKind}
                      onChange={(e) => {
                        const kind = e.target
                          .value as PublicService["priceKind"];
                        setData({
                          services: services.map((item, n) =>
                            n === i
                              ? {
                                  ...item,
                                  priceKind: kind,
                                  amountCents:
                                    kind === "on-request"
                                      ? null
                                      : (item.amountCents ?? 0),
                                }
                              : item,
                          ),
                        });
                      }}
                    >
                      <option value="fixed">
                        <WorkspaceText text={"Fixed"} />
                      </option>
                      <option value="from">
                        <WorkspaceText text={"From"} />
                      </option>
                      <option value="on-request">
                        <WorkspaceText text={"Price on request"} />
                      </option>
                    </select>
                  </label>
                  {s.priceKind !== "on-request" && (
                    <label>
                      <WorkspaceText text={"Public list price"} />
                      <input
                        type="number"
                        min="0"
                        step={10 ** -priceDigits(s.currency)}
                        key={s.currency}
                        defaultValue={publicPriceInput(
                          s.amountCents,
                          s.currency,
                        )}
                        onChange={(e) =>
                          changeService(
                            i,
                            "amountCents",
                            parsePublicPrice(e.target.value, s.currency),
                          )
                        }
                      />
                    </label>
                  )}
                  {text(
                    "Currency (three-letter code)",
                    s.currency,
                    (v) => changeService(i, "currency", v.toUpperCase()),
                    3,
                  )}
                  <label>
                    <WorkspaceText
                      text={"Duration in minutes (blank = unknown)"}
                    />
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      step="1"
                      value={s.durationMinutes ?? ""}
                      onChange={(e) =>
                        changeService(
                          i,
                          "durationMinutes",
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                </div>
                <label>
                  <WorkspaceText text={"Description"} />
                  <textarea
                    maxLength={1000}
                    value={s.description}
                    onChange={(e) =>
                      changeService(i, "description", e.target.value)
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setData({ services: services.filter((_, n) => n !== i) })
                  }
                >
                  <WorkspaceText text={"Remove service"} />
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              disabled={services.length >= 100}
              onClick={() =>
                setData({
                  services: [
                    ...services,
                    {
                      id: crypto.randomUUID(),
                      name: "",
                      category: "",
                      description: "",
                      priceKind: "on-request",
                      amountCents: null,
                      currency: "USD",
                      durationMinutes: null,
                    },
                  ],
                })
              }
            >
              <WorkspaceText text={"Add public service"} />
            </button>
          </>
        )}
        {group === "media" && (
          <>
            {!workspace.imageDeliveryReady && (
              <p role="status">
                <WorkspaceText text="Photo delivery is not enabled in this environment. An administrator must enable secure image delivery before apps can display selected photos." />
              </p>
            )}
            <p>
              <WorkspaceText
                text={
                  "Select only salon photos you have rights to publish. No client/staff portraits, private photos or personal information. Images are re-encoded without EXIF by the API gateway; originals and storage paths are not shared with apps."
                }
              />
            </p>
            {!workspace.assets.length && (
              <p>
                <WorkspaceText
                  text={
                    "No eligible salon photos. Add processed salon photos in your salon profile first. Review and staff-avatar photos cannot be selected."
                  }
                />
              </p>
            )}
            <div className={styles.photos}>
              {workspace.assets.map((asset) => (
                <label key={asset.id} className={styles.photo}>
                  {asset.previewUrl && (
                    <img
                      src={asset.previewUrl}
                      alt={"Your salon " + asset.purpose}
                      loading="lazy"
                    />
                  )}
                  <span>{asset.purpose}</span>
                  <input
                    type="checkbox"
                    checked={images.some((x) => x.assetId === asset.id)}
                    onChange={(e) =>
                      setData({
                        images: e.target.checked
                          ? [
                              ...images,
                              {
                                assetId: asset.id,
                                label: asset.purpose,
                                caption: "",
                                rights: "owner",
                                role:
                                  asset.purpose === "logo" ? "logo" : "gallery",
                              },
                            ]
                          : images.filter((x) => x.assetId !== asset.id),
                      })
                    }
                  />
                  <WorkspaceText text={"Share this selected photo"} />
                </label>
              ))}
            </div>
            {images.map((image, i) => (
              <fieldset key={image.assetId}>
                <legend>
                  <WorkspaceText text={"Selected photo "} />
                  {i + 1}
                </legend>
                {text(
                  "Accessible label",
                  image.label,
                  (v) => changeImage(i, "label", v),
                  100,
                )}
                {text(
                  "Public caption",
                  image.caption,
                  (v) => changeImage(i, "caption", v),
                  500,
                )}
                <label>
                  <WorkspaceText text={"Usage rights"} />
                  <select
                    value={image.rights}
                    onChange={(e) => changeImage(i, "rights", e.target.value)}
                  >
                    <option value="owner">
                      <WorkspaceText text={"Salon owns rights"} />
                    </option>
                    <option value="licensed">
                      <WorkspaceText text={"Licensed for this public use"} />
                    </option>
                  </select>
                </label>
                <label>
                  <WorkspaceText text={"Display role"} />
                  <select
                    value={image.role}
                    onChange={(e) => changeImage(i, "role", e.target.value)}
                  >
                    <option value="logo">
                      <WorkspaceText text={"Logo"} />
                    </option>
                    <option value="gallery">
                      <WorkspaceText text={"Gallery"} />
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setData({ images: images.filter((_, n) => n !== i) })
                  }
                >
                  <WorkspaceText text={"Stop sharing this photo"} />
                </button>
              </fieldset>
            ))}
            <p>
              <WorkspaceText
                text={
                  "Unsharing takes effect after you save/publish. It cannot recall copies previously downloaded or remove an original already public elsewhere."
                }
              />
            </p>
          </>
        )}
        {group === "content" && (
          <>
            {entries.map((entry, i) => (
              <fieldset key={entry.id}>
                <legend>
                  <WorkspaceText text={"Content "} />
                  {i + 1}
                </legend>
                <label>
                  <WorkspaceText text={"Type"} />
                  <select
                    value={entry.kind}
                    onChange={(e) => changeEntry(i, "kind", e.target.value)}
                  >
                    <option value="faq">
                      <WorkspaceText text={"FAQ"} />
                    </option>
                    <option value="policy">
                      <WorkspaceText text={"Policy"} />
                    </option>
                    <option value="guide">
                      <WorkspaceText text={"Guide"} />
                    </option>
                  </select>
                </label>
                {text(
                  "Public title / question",
                  entry.title,
                  (v) => changeEntry(i, "title", v),
                  150,
                )}
                <label>
                  <WorkspaceText text={"Public text / answer"} />
                  <textarea
                    maxLength={2000}
                    value={entry.body}
                    onChange={(e) => changeEntry(i, "body", e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setData({ entries: entries.filter((_, n) => n !== i) })
                  }
                >
                  <WorkspaceText text={"Remove content"} />
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              disabled={entries.length >= 30}
              onClick={() =>
                setData({
                  entries: [
                    ...entries,
                    {
                      id: crypto.randomUUID(),
                      kind: "faq",
                      title: "",
                      body: "",
                    },
                  ],
                })
              }
            >
              <WorkspaceText text={"Add public content"} />
            </button>
            <p>
              <WorkspaceText
                text={
                  "Plain text only. Publishing content does not execute HTML or change booking, payment or refund settings."
                }
              />
            </p>
          </>
        )}
        <label className={styles.confirm}>
          <input type="checkbox" name="consent" value="yes" />
          <WorkspaceText
            text={
              "I approve these exact business fields and selected photo rights for public sharing. No private or customer information is included."
            }
          />
        </label>
        <div className={styles.buttons}>
          <button name="intent" value="draft" disabled={pending || state.uncertain}>
            <WorkspaceText text={"Save draft"} />
          </button>
          <button name="intent" value="publish" disabled={pending || state.uncertain}>
            <WorkspaceText text={"Publish this revision"} />
          </button>
          {row?.hasDraft && <button name="intent" value="discard" formNoValidate onClick={event=>{if(!window.confirm(translate("Discard the saved draft and unsaved edits? The shared revision will stay unchanged.")))event.preventDefault();}}><WorkspaceText text="Discard draft" /></button>}
          {row?.published && !stopConfirmed && <button type="button" disabled={pending || state.uncertain} onClick={() => setStopConfirmed(true)}><WorkspaceText text="Stop sharing this group" /></button>}
          {row?.published && stopConfirmed && <>
            <p><WorkspaceText text="Stopping sharing can make connected public menus unavailable. Your draft is kept. Copies already received cannot be recalled." /></p>
            <button
              formNoValidate
              name="intent"
              value="unpublish"
              disabled={pending || state.uncertain}
            >
              <WorkspaceText text={"Confirm stop sharing"} />
            </button>
            <button type="button" disabled={pending || state.uncertain} onClick={() => setStopConfirmed(false)}><WorkspaceText text="Keep sharing" /></button>
          </>}
        </div>
        </fieldset>
        {pending && (
          <p role="status">
            <WorkspaceText text={"Saving…"} />
          </p>
        )}
        {state.message && (
          <p role="status">
            <WorkspaceText text={state.message} />
          </p>
        )}
        {state.uncertain && <button type="button" onClick={() => window.location.reload()}><WorkspaceText text="Reload to check publication" /></button>}
      </form>
    </section>
  );
}
