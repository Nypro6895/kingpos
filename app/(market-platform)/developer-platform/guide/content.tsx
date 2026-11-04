"use client";
import {developerGuide} from "@/lib/market-platform/developer-guide";
import {DeveloperLanguagePicker, useDeveloperLanguage} from "../sections";
export function GuideContent() {
  const language=useDeveloperLanguage();
  return <><header><DeveloperLanguagePicker /><h1>{language==="vi"?"Hướng dẫn tạo và nộp plugin":"Build and submit a plugin"}</h1>
    <p>{language==="vi"?"Từ tài khoản developer đến app được Owner cài. Hướng dẫn hợp đồng hiện hành; kết quả vận hành cần nghiệm thu riêng.":"From developer account to an Owner-installed app. Current integration contract; operational acceptance is separate."}</p>
    <nav><a href={"/developer-platform?lang="+language}>{language==="vi"?"Mở không gian developer":"Open Developer workspace"}</a> · <a href="/api/market-platform/manifest">{language==="vi"?"Manifest mẫu":"Manifest example"}</a> · <a href="/developer/qr-menu-example.zip" download>{language==="vi"?"Tải source QR Menu":"Download QR Menu source"}</a> · <a href={"/developer-platform/guide/recovery?lang="+language}>{language==="vi"?"Xử lý lỗi và phục hồi":"Troubleshooting and recovery"}</a></nav></header>
    {developerGuide.map(section=><section key={section.title.en}><h2>{section.title[language]}</h2><p>{section.body[language]}</p></section>)}
  </>;
}
