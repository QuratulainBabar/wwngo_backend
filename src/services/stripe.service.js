import { env } from '../config/env.js';

let stripe = null;

export function isConfigured() {
  return Boolean(env.stripe?.secretKey);
}

async function getStripe() {
  if (!isConfigured()) return null;
  if (!stripe) {
    const mod = await import('stripe');
    stripe = mod.default(env.stripe.secretKey);
  }
  return stripe;
}

export async function createPaymentIntent({ amountCents, customerId, metadata = {} }) {
  const s = await getStripe();
  if (!s) {
    return { id: `mock_pi_${Date.now()}`, status: 'succeeded', mock: true };
  }
  return s.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    metadata: { ...metadata, userId: customerId },
    automatic_payment_methods: { enabled: true },
  });
}

export async function createConnectAccount({ email, userId }) {
  const s = await getStripe();
  if (!s) {
    return { id: `mock_acct_${userId}`, mock: true };
  }
  return s.accounts.create({
    type: 'express',
    email,
    capabilities: {
      transfers: { requested: true },
    },
    metadata: { userId },
  });
}

export async function createConnectAccountLink(accountId, { refreshUrl, returnUrl }) {
  const s = await getStripe();
  if (!s) {
    return { url: `${returnUrl}?mock_connect=1`, mock: true };
  }
  return s.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
}

export async function getConnectAccount(accountId) {
  const s = await getStripe();
  if (!s) return { id: accountId, charges_enabled: false, mock: true };
  return s.accounts.retrieve(accountId);
}

export async function createConnectTransfer({ amountCents, destinationAccount, metadata = {} }) {
  const s = await getStripe();
  if (!s) {
    return { id: `mock_tr_${Date.now()}`, mock: true };
  }
  return s.transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: destinationAccount,
    metadata,
  });
}

export async function handleWebhook(rawBody, signature) {
  const s = await getStripe();
  if (!s || !env.stripe.webhookSecret) {
    return { received: true, mock: true };
  }
  const event = s.webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret);

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    if (intent.metadata?.purpose === 'wallet_top_up') {
      const walletService = await import('./wallet.service.js');
      await walletService.completeTopUpFromPaymentIntent(intent.id);
    }
  }

  return { received: true, type: event.type, data: event.data.object };
}
