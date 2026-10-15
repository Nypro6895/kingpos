"use client";

import { useState } from "react";
import Image from "next/image";
import styles from "./market.module.css";

const previews = [
  { file: "today", title: "Hôm nay (Today)", caption: "Xem doanh thu, khách đang chờ, lịch hẹn, nhân viên và hiệu quả trong ngày bằng tiếng Việt.", width: 1400, height: 1566 },
  { file: "services", title: "Quản lý dịch vụ", caption: "Xem giá, thời lượng, trạng thái và nhân viên nhận lịch bằng tiếng Việt.", width: 1120, height: 475 },
  { file: "service-settings", title: "Cài đặt dịch vụ", caption: "Chỉnh sửa thông tin dịch vụ, bật đặt lịch trực tuyến và chọn nhân viên.", width: 1120, height: 1651 },
  { file: "customers", title: "Hồ sơ khách hàng", caption: "Các nhãn và thao tác được Việt hóa; tên khách, thông tin liên hệ và ghi chú được giữ nguyên.", width: 1120, height: 915 },
];

export function VietnamesePreview() {
  const [selected, setSelected] = useState(0);
  const current = previews[selected];
  const src = `/market/features/vietnamese-language/${current.file}-v1.png`;
  return <section className={styles.campaignPreview} lang="vi" aria-label="Xem trước giao diện tiếng Việt">
    <h3>Giao diện thực tế bằng tiếng Việt</h3>
    <div className={`${styles.previewChoices} ${styles.vietnameseChoices}`} role="tablist" aria-label="Màn hình minh họa">
      {previews.map((preview, index) => <button key={preview.file} id={`vietnamese-preview-tab-${index}`} role="tab" aria-selected={selected === index} aria-controls="vietnamese-preview-panel" tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % previews.length : event.key === "ArrowLeft" ? (index + previews.length - 1) % previews.length : event.key === "Home" ? 0 : event.key === "End" ? previews.length - 1 : null;
        if (next !== null) { event.preventDefault(); setSelected(next); document.getElementById(`vietnamese-preview-tab-${next}`)?.focus(); }
      }}>{preview.title}</button>)}
    </div>
    <figure id="vietnamese-preview-panel" role="tabpanel" aria-labelledby={`vietnamese-preview-tab-${selected}`} className={styles.previewFigure}>
      <div className={styles.vietnameseScreenshot} tabIndex={0} role="region" aria-label={`Ảnh giao diện ${current.title}`}><Image src={src} alt={`Ảnh chụp giao diện Reylumi bằng tiếng Việt: ${current.title}, sử dụng dữ liệu minh họa.`} width={current.width} height={current.height} sizes="(max-width: 560px) 90vw, 800px" /></div>
      <figcaption><strong>{current.title}</strong><p>{current.caption}</p><div className={styles.previewFoot}><span>Ảnh chụp từ giao diện thật, sử dụng dữ liệu minh họa.</span><a href={src} target="_blank" rel="noopener noreferrer">Mở ảnh lớn ↗</a></div></figcaption>
    </figure>
  </section>;
}
