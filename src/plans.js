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

function getPlan(id) {
  return PLANS[id] || PLANS.free;
}

// JSON cannot encode Infinity, so expose unlimited values as null.
function publicPlan(plan) {
  return Object.fromEntries(
    Object.entries(plan).map(([k, v]) => [k, v === Infinity ? null : v])
  );
}

module.exports = { PLANS, getPlan, publicPlan };
