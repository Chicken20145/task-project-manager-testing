export function timezoneLabel(zone, language = 'vi', now = new Date()) {
  if (typeof zone !== 'string' || !zone) zone = 'UTC';
  const map = {
    'Asia/Ho_Chi_Minh': { vi: 'Việt Nam', en: 'Vietnam' },
    'Asia/Bangkok': { vi: 'Bangkok', en: 'Bangkok' },
    'Asia/Singapore': { vi: 'Singapore', en: 'Singapore' },
    'Asia/Tokyo': { vi: 'Tokyo', en: 'Tokyo' },
    'Asia/Kolkata': { vi: 'Ấn Độ', en: 'India' },
    'UTC': { vi: 'UTC', en: 'UTC' },
    'Europe/London': { vi: 'London', en: 'London' },
    'Europe/Berlin': { vi: 'Berlin', en: 'Berlin' },
    'America/New_York': { vi: 'New York', en: 'New York' },
    'America/Los_Angeles': { vi: 'Los Angeles', en: 'Los Angeles' },
    'Australia/Sydney': { vi: 'Sydney', en: 'Sydney' },
    'Pacific/Auckland': { vi: 'Auckland', en: 'Auckland' }
  };

  let offset = 'UTC+00:00';
  let friendlyName = zone;

  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset'
    });
    const parts = dtf.formatToParts(now);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart && tzPart.value) {
      let val = tzPart.value;
      if (val === 'GMT') {
        offset = 'UTC+00:00';
      } else if (val.startsWith('GMT')) {
        offset = val.replace('GMT', 'UTC');
      }
    }
  } catch (e) {
    return zone;
  }

  if (map[zone]) {
    friendlyName = map[zone][language] || map[zone]['vi'] || zone;
  }

  return `${offset} — ${friendlyName}`;
}
