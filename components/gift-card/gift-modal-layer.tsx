"use client";
import {useEffect,useRef,type ReactNode} from "react";
import {createPortal} from "react-dom";
export function GiftModalLayer({children,onClose}:{children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;const before=document.activeElement as HTMLElement|null;dialog?.showModal();return()=>{if(dialog?.open)dialog.close();before?.focus();};},[]);
  if(typeof document==="undefined")return null;
  return createPortal(<dialog ref={ref} className="gc-modal-layer" onCancel={event=>{event.preventDefault();onClose();}}>{children}</dialog>,document.body);
}
