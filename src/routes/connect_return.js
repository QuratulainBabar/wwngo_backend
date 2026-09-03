/**
 * Public Stripe Connect return/refresh landing pages.
 * Stripe redirects the mobile browser here after Agree & Submit.
 * The page deep-links back into the WWNGO app success screen.
 */
export function connectReturnPage(req, res) {
  const status = String(req.query.connect || req.query.status || 'done').toLowerCase();
  const isRefresh = status === 'refresh';
  const role = String(req.query.role || '').toLowerCase();
  const roleQ = ['sender', 'traveler', 'receiver'].includes(role)
    ? `&role=${role}`
    : '';
  const pathAndQuery = isRefresh
    ? `/wallet/connect-success?status=refresh${roleQ}`
    : `/wallet/connect-success?status=done${roleQ}`;
  // Triple-slash so go_router matches `/wallet/connect-success` (empty host).
  const deepLink = `wwngo://${pathAndQuery}`;
  const intentLink =
    `intent://${pathAndQuery.replace(/^\//, '')}` +
    '#Intent;scheme=wwngo;package=com.wwngo.wwngo_app;end';
  const title = isRefresh ? 'Continue payout setup' : 'Payout account connected';
  const body = isRefresh
    ? 'Return to WWNGO to finish linking your payout account.'
    : 'Your Stripe payout account is connected. You can withdraw to your bank from the WWNGO wallet.';
  const button = isRefresh ? 'Open WWNGO' : 'Back to WWNGO';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'"
  );
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: Segoe UI, system-ui, sans-serif; background: #F9FAFB; color: #111827; }
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px 24px; }
    .card { max-width: 360px; width: 100%; text-align: center; }
    .check { width: 80px; height: 80px; margin: 0 auto 20px; border-radius: 40px; background: rgba(16,185,129,.12); display: flex; align-items: center; justify-content: center; font-size: 40px; color: #10B981; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { font-size: 15px; line-height: 1.5; color: #6B7280; margin: 0 0 32px; }
    a { display: block; background: #1A56DB; color: #fff; text-decoration: none; font-weight: 700; padding: 14px 20px; border-radius: 14px; }
  </style>
  <script>
    (function () {
      var app = ${JSON.stringify(deepLink)};
      var intent = ${JSON.stringify(intentLink)};
      try { window.location.replace(app); } catch (e) {}
      setTimeout(function () {
        try { window.location.replace(intent); } catch (e) {}
      }, 350);
    })();
  </script>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="check">✓</div>
      <h1>${title}</h1>
      <p>${body}</p>
      <a href="${deepLink}">${button}</a>
    </div>
  </div>
</body>
</html>`);
}
