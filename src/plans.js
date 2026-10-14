'use strict';

// Gói dịch vụ SaaS. Giá tính theo VND/tháng; Infinity = không giới hạn.
const PLANS = {
  free: {
    id: 'free',
    name: 'Miễn phí',
    priceVnd: 0,
    maxSites: 1,
    maxPagesPerSite: 3,
    maxMembers: 1,
    maxLeadsPerMonth: 100,
    customDomain: false,
    removeBranding: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceVnd: 199000,
    maxSites: 10,
    maxPagesPerSite: 50,
    maxMembers: 5,
    maxLeadsPerMonth: 10000,
    customDomain: true,
    removeBranding: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    priceVnd: 599000,
    maxSites: Infinity,
    maxPagesPerSite: Infinity,
    maxMembers: 50,
    maxLeadsPerMonth: Infinity,
    customDomain: true,
    removeBranding: true,
  },
};

// Billing cycles: yearly pays for 10 months (2 months free).
const BILLING_CYCLES = { 1: 1, 12: 10 };

function getPlan(id) {
  return PLANS[id] || PLANS.free;
}

// A paid plan falls back to free once its subscription expires.
// plan_expires_at = NULL means no expiry (free plan, or granted by a platform admin).
function effectivePlanId(ws, now = new Date()) {
  if (ws.plan !== 'free' && ws.plan_expires_at && new Date(ws.plan_expires_at) <= now) return 'free';
  return PLANS[ws.plan] ? ws.plan : 'free';
}

function workspacePlan(ws) {
  return getPlan(effectivePlanId(ws));
}

function priceFor(planId, months) {
  const plan = PLANS[planId];
  const factor = BILLING_CYCLES[months];
  if (!plan || !plan.priceVnd || !factor) return null;
  return plan.priceVnd * factor;
}

// JSON cannot encode Infinity, so expose unlimited values as null.
function publicPlan(plan) {
  return Object.fromEntries(
    Object.entries(plan).map(([k, v]) => [k, v === Infinity ? null : v])
  );
}

module.exports = { PLANS, BILLING_CYCLES, getPlan, effectivePlanId, workspacePlan, priceFor, publicPlan };
