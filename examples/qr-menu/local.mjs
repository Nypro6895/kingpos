import {createQrMenuApp} from "./server.mjs";
  const app = createQrMenuApp({
    api: process.env.REYLUMI_MARKET_API_ORIGIN ?? "http://127.0.0.1:4328",
    clientId: process.env.REYLUMI_MARKET_CLIENT_ID,
    clientSecret: process.env.REYLUMI_MARKET_CLIENT_SECRET,
    publicOrigin: process.env.QR_MENU_PUBLIC_ORIGIN ?? "http://127.0.0.1:4344",
    sandboxToken: process.env.QR_MENU_SANDBOX_TOKEN,
    secureCookie:
      process.env.QR_MENU_PUBLIC_ORIGIN?.startsWith("https:") ?? false,
  });
  app.listen(4344, "127.0.0.1", () =>
    console.log(
      "QR menu example listening on loopback4344. No secrets are logged.",
    ),
  );
