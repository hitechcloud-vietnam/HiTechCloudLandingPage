'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;

// Custom-domain ownership check. A domain is accepted when either
//  - TXT  _htc-verify.<domain>  contains  htc-verify=<token>, or
//  - CNAME <domain>  points at the configured CNAME_TARGET.
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
      if (target) {
        const cnames = (await safe(() => resolver.resolveCname(domain))).map((c) => c.toLowerCase().replace(/\.$/, ''));
        if (cnames.includes(target)) return { ok: true, method: 'cname' };
      }
      return { ok: false };
    },
  };
}

module.exports = { createDomainVerifier, newDomainToken };
