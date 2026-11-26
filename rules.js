export const RULE_TYPES = {
  domain: "Domain and subdomains",
  prefix: "URL begins with",
  exact: "Exact URL",
  contains: "URL contains",
};

export function webUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function parseRule(type, input) {
  const value = input.trim();
  if (!Object.hasOwn(RULE_TYPES, type) || !value || value.length > 2048) {
    throw new Error("Enter a valid match value of up to 2,048 characters.");
  }

  if (type === "contains") return { type, value };

  if (type === "domain") {
    const domain = webUrl("https://" + value);
    if (!domain || /[\s/:?#@\\%]/u.test(value)) {
      throw new Error("Enter a domain such as example.com.");
    }
    const hostname = domain.hostname.replace(/\.$/u, "");
    if (!hostname || hostname.split(".").some((label) => !label)) {
      throw new Error("Enter a domain such as example.com.");
    }
    return { type, value: hostname };
  }

  const url = webUrl(value);
  if (!/^https?:\/\//iu.test(value) || !url || url.username || url.password) {
    throw new Error("Enter a full web URL starting with https:// or http://.");
  }
  return { type, value: url.href };
}

export function isEligible(url, settings) {
  if (!url) return false;
  if (settings.scope === "all") return true;

  const hostname = url.hostname.replace(/\.$/u, "");
  return settings.rules.some(({ type, value }) => {
    switch (type) {
      case "domain":
        return hostname === value || hostname.endsWith("." + value);
      case "prefix":
        return url.href.startsWith(value);
      case "exact":
        return url.href === value;
      case "contains":
        return url.href.includes(value);
      default:
        return false;
    }
  });
}
