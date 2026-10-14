'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;

// Custom-domain ownership check: TXT _htc-verify.<domain> must contain
// htc-verify=<token>, where the token is issued to the site claiming the domain.
// A CNAME to CNAME_TARGET only routes traffic; it is not proof of ownership,
// since any tenant could otherwise claim a domain already pointed at us.
// Only verified domains are served and get TLS certificates.

function newDomainToken() {
  return crypto.randomBytes(16).toString('hex');
}

function createDomainVerifier(config) {
  const resolver = config.dnsResolver || dns;
  const target = (config.cnameTarget || '').replace(/\.$/, '');

  async function safe(fn) {
    try {
      return await fn();
    } catch {
      return [];
    }
  }

  return {
    instructions(site) {
      return {
        txtName: `_htc-verify.${site.custom_domain}`,
        txtValue: `htc-verify=${site.domain_token}`,
        cnameTarget: target || null,
      };
    },

    async verify(site) {
      const domain = site.custom_domain;
      const txt = (await safe(() => resolver.resolveTxt(`_htc-verify.${domain}`))).map((parts) => parts.join(''));
      if (txt.includes(`htc-verify=${site.domain_token}`)) return { ok: true, method: 'txt' };
      return { ok: false };
    },
  };
}

// Unverified claims older than this can be taken over by another site,
// so nobody can squat a domain they do not control.
const CLAIM_TTL_HOURS = 72;

module.exports = { createDomainVerifier, newDomainToken, CLAIM_TTL_HOURS };
