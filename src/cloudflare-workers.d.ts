// Minimal ambient types for workerd's built-in module, to avoid pulling in
// @cloudflare/workers-types just for two symbols.
declare module 'cloudflare:workers' {
	export const env: Record<string, any>;

	export class DurableObject {
		ctx: {
			storage: {
				get(key: string): Promise<unknown>;
				put(key: string, value: unknown): Promise<void>;
			};
		};
		constructor(ctx: unknown, env: unknown);
	}
}
