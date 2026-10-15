"use client";
import {openMarketPayment} from "@/lib/open-market-payment";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setVietnamesePlugin, vietnamesePaymentAction } from "./vietnamese-actions";
import type { VietnamesePluginState } from "@/types/vietnamese-plugin";
import styles from "./market.module.css";

export function VietnamesePluginPanel({ initialState, onChange, paymentsAvailable = true, bankCheckout = false, monthlyPrice = "$3.99 / tháng" }: { initialState: VietnamesePluginState; onChange: (state: VietnamesePluginState) => void; paymentsAvailable?: boolean; bankCheckout?: boolean; monthlyPrice?: string }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [staff, setStaff] = useState(state.staff_enabled);
  const [portable, setPortable] = useState(state.portable_enabled);
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  function save(installed: boolean) {
    startTransition(async () => {
      const result = await setVietnamesePlugin(installed, staff, portable);
      if (result.error) setMessage(result.error);
      else if (result.state) { setState(result.state); onChange(result.state); setMessage(installed ? "Đã lưu tùy chọn tiếng Việt." : "Đã gỡ plugin. Thuê bao sẽ dừng gia hạn vào cuối kỳ nếu có."); router.refresh(); }
    });
  }
  function payment() {
    startTransition(async () => {
      const result = await vietnamesePaymentAction(state.has_subscription);
      if (result.url) openMarketPayment(result.url);
      else setMessage(result.error ?? "Không thể mở thanh toán.");
    });
  }
  const trial = state.trial_ends_at && Date.parse(state.trial_ends_at) > now;
  const prepaid = state.active && !trial && !state.has_subscription;
  return <section lang="vi" aria-label="Tùy chọn plugin tiếng Việt">
    <h3>Tiếng Việt cho tiệm của bạn</h3>
    <p>{monthlyPrice} USD / tiệm · Dùng thử 5 ngày. Tùy chọn nhân viên và Portable đã bao gồm trong giá.</p>
    <p>Giao diện chủ tiệm: điều hướng, lịch hẹn, nhân viên, dịch vụ, khách hàng, bán hàng, lương và báo cáo. Tên, ghi chú và nội dung do người dùng nhập được giữ nguyên.</p>
    <fieldset disabled={busy} className={styles.languageOptions}>
      <label><input type="checkbox" checked={staff} onChange={event => setStaff(event.target.checked)} />Áp dụng cho nhân viên của tiệm: lịch hẹn, lịch làm việc, lương và các yêu cầu với chủ tiệm.</label>
      <label><input type="checkbox" checked={portable} onChange={event => setPortable(event.target.checked)} />Áp dụng cho Portable (ứng dụng POS trên máy tính của tiệm).</label>
    </fieldset>
    {state.installed && <p>{state.active ? trial ? `Dùng thử đến ${new Date(state.trial_ends_at!).toLocaleString("vi-VN")}.` : "Plugin đang hoạt động." : "Dùng thử đã kết thúc. Đăng ký để tiếp tục sử dụng."}</p>}
    <p role="status">{message}</p>
    {!bankCheckout && !paymentsAvailable && !state.has_subscription && <p>Thanh toán thuê bao hiện chưa sẵn sàng. Chuyển khoản ngân hàng chưa được hỗ trợ.</p>}
    {prepaid && <p>Bạn vẫn có quyền sử dụng đến hết kỳ đã thanh toán. Có thể đăng ký lại khi kỳ này kết thúc.</p>}
    <div className={styles.languageActions}>
      <button className={styles.primary} disabled={busy} onClick={() => save(true)}>{busy ? "Đang cập nhật…" : state.installed ? "Lưu tùy chọn" : state.trial_ends_at ? "Thêm lại plugin" : "Dùng thử miễn phí 5 ngày"}</button>
      {state.installed && <button className={styles.secondary} disabled={busy} onClick={() => save(false)}>Gỡ plugin</button>}
      {(state.has_subscription || (!bankCheckout && state.installed && !trial)) && <button className={styles.secondary} disabled={busy || (!state.has_subscription && (!paymentsAvailable || prepaid))} onClick={payment}>{state.has_subscription ? "Quản lý thuê bao" : "Đăng ký $3.99 / tháng"}</button>}
    </div>
    {!bankCheckout && !state.has_subscription && <p>Không cần thẻ để dùng thử. Hết 5 ngày, bạn có thể đăng ký thanh toán hàng tháng. Không tự động thu tiền trong thời gian dùng thử.</p>}
  </section>;
}
