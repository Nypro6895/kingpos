"use client";
import "./owner-pos.css";

import Link from "next/link";
import { useRef, useState } from "react";
import { ROLE_NAVIGATION } from "@/app/role-navigation";
import { OwnerPosIcon, type OwnerPosIconName } from "./owner-pos-icon";

const shortcuts: { id: string; href: string; label: string; icon: OwnerPosIconName }[] = [
 {id:'pos',href:'/pos',label:'POS',icon:'pos'},
 {id:'ticket',href:'/pos/ticket',label:'Ticket',icon:'ticket'},
 {id:'book',href:'/pos/book',label:'Book',icon:'booking'},
 {id:'checkIn',href:'/pos/check-in',label:'Check In',icon:'checkin'},
 {id:'report',href:'/pos/report',label:'Report',icon:'report'},
 {id:'settings',href:'/pos/settings',label:'Settings',icon:'settings'},
];
const menus = [...ROLE_NAVIGATION.owner.links, ...ROLE_NAVIGATION.owner.moreLinks,
  { href: "/pos/settings", label: "POS Settings", id: "pos-settings" },
  { href: "/settings", label: "Account Settings", id: "account-settings" },
].filter((item, index, items) => items.findIndex(other => other.href === item.href) === index);

export function OwnerPosTabs({ active }: { active: "pos" | "ticket" | "book" | "checkIn" | "report" | "settings" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { dialog.current?.close(); setOpen(false); };
  if (active === "settings") return <nav aria-label="Owner POS"><Link className="owner-switch" href="/pos" aria-label="Back to POS" title="Back to POS"><OwnerPosIcon name="pos" /></Link></nav>;
  return <>
    <nav className="owner-top-nav" aria-label="Owner POS">
      <button className="owner-nav-item owner-more-button" aria-label="More" aria-haspopup="dialog" aria-expanded={open} onClick={() => { dialog.current?.showModal(); setOpen(true); }}><OwnerPosIcon name="more" /><span>More</span></button>
      {shortcuts.map(item => <Link className="owner-nav-item" href={item.href} key={item.href} aria-label={item.label} aria-current={item.id === active ? "page" : undefined}><OwnerPosIcon name={item.icon} /><span>{item.label}</span></Link>)}
    </nav>
    <dialog ref={dialog} className="owner-menu-dialog" aria-labelledby="owner-menu-title" onCancel={close} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
      <header><h2 id="owner-menu-title">All menus</h2><button onClick={close} aria-label="Close menus">×</button></header>
      <div className="owner-menu-links">{menus.map(item => <Link key={item.id} href={item.href} onClick={close}>{item.label}<span aria-hidden="true">›</span></Link>)}</div>
    </dialog>
  </>;
}
