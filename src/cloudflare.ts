import { dispatch } from '@flue/runtime';
import { Keeper } from './agents/keeper.ts';

// One long-running conversation: every fire continues the same 'nightly' instance,
// so memory and playbook carry over from night to night.
const ID = 'nightly';

const MESSAGES: Record<string, string> = {
	'0 0 * * *':
		'午夜深度扫描:完整走一遍工作循环(CI、风险代码模式、可疑文件),更新记忆与 playbook,输出本次报告。',
	'0 */6 * * *':
		'快速健康检查:只看 CI 失败与上次报告遗留的 action 项,若有生产级问题立即 page,否则一句话汇报。',
};

export default {
	async scheduled(controller: { cron: string; scheduledTime: number }) {
		await dispatch(Keeper, {
			id: ID,
			message: {
				kind: 'signal',
				type: 'schedule',
				body: MESSAGES[controller.cron] ?? `定时扫描 (cron=${controller.cron})。`,
				attributes: {
					cron: controller.cron,
					scheduledAt: new Date(controller.scheduledTime).toISOString(),
				},
			},
		});
	},
};
