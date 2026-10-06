// Paging / alerting. Pure functions so it stays testable without the framework.

export type Severity = 'info' | 'warning' | 'critical';

export function pagerPayload(severity: Severity, summary: string, source: string) {
	const dedupKey = `keeper:${source}:${summary.slice(0, 80)}`;
	return {
		routing_key: process.env.PAGER_ROUTING_KEY ?? '',
		dedup_key: dedupKey,
		event_action: 'trigger',
		payload: {
			summary: summary.slice(0, 1024),
			severity: severity === 'critical' ? 'critical' : 'warning',
			source,
		},
	};
}

/** Fire a page: PagerDuty Events v2 when PAGER_ROUTING_KEY is set,
 *  else a plain JSON webhook at PAGER_WEBHOOK_URL. */
export async function sendPage(severity: Severity, summary: string, source = 'celadon'): Promise<string> {
	if (process.env.PAGER_ROUTING_KEY) {
		const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(pagerPayload(severity, summary, source)),
		});
		if (!res.ok) throw new Error(`PagerDuty ${res.status}: ${await res.text()}`);
		return `Paged PagerDuty (${severity}).`;
	}
	if (process.env.PAGER_WEBHOOK_URL) {
		const res = await fetch(process.env.PAGER_WEBHOOK_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ severity, summary, source, at: new Date().toISOString() }),
		});
		if (!res.ok) throw new Error(`Pager webhook ${res.status}: ${await res.text()}`);
		return `Paged webhook (${severity}).`;
	}
	// ponytail: no silent no-op — tell the model the alert went nowhere.
	return `No PAGER_ROUTING_KEY / PAGER_WEBHOOK_URL configured — page NOT delivered: [${severity}] ${summary}`;
}
