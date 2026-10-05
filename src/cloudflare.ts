import { dispatch } from '@flue/runtime';
import { DurableObject } from 'cloudflare:workers';
import { Keeper } from './agents/keeper.ts';
import { getConfig } from './config.ts';

// App-owned Durable Object: one instance ("default") holds the keeper config
// edited from the web page at celadon.chat/.
export class ConfigStore extends DurableObject {
	async get(): Promise<unknown> {
		return (await this.ctx.storage.get('config')) ?? {};
	}

	async set(config: unknown): Promise<void> {
		await this.ctx.storage.put('config', config);
	}
}

// One long-running conversation: every fire continues the same 'nightly' instance,
// so memory and playbook carry over from night to night.
const ID = 'nightly';

export default {
	async scheduled(controller: { cron: string; scheduledTime: number }) {
		const cfg = await getConfig();
		const slot = controller.cron === '0 0 * * *' ? cfg.daily : cfg.quick;
		if (!slot.enabled) return;
		await dispatch(Keeper, {
			id: ID,
			message: {
				kind: 'signal',
				type: 'schedule',
				body: cfg.extra ? `${slot.task}\n\n附加指令:\n${cfg.extra}` : slot.task,
				attributes: {
					cron: controller.cron,
					scheduledAt: new Date(controller.scheduledTime).toISOString(),
				},
			},
		});
	},
};
