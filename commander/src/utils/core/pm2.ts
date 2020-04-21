import fsExtra from 'fs-extra';
import * as path from 'path';
import {
	connect,
	delete as del,
	describe,
	disconnect,
	list,
	ProcessDescription,
	restart,
	start,
	stop,
} from 'pm2';

import { NETWORK } from '../constants';

export type ProcessStatus =
	| 'online'
	| 'stopping'
	| 'stopped'
	| 'launching'
	| 'errored'
	| 'one-launch-status';

export interface Pm2Env {
	readonly LISK_NETWORK: NETWORK;
	readonly LISK_DB_PORT: string;
	readonly LISK_REDIS_PORT: string;
	readonly LISK_WS_PORT: string;
	readonly LISK_HTTP_PORT: string;
	// eslint-disable-next-line camelcase
	readonly pm_cwd: string;
	// eslint-disable-next-line camelcase
	readonly pm_uptime: number;
	readonly status: ProcessStatus;
	// eslint-disable-next-line camelcase
	readonly unstable_restarts: number;
	readonly version: string;
}

export type ReadableInstanceType = string | undefined | number;

interface InstanceIndex {
	readonly [key: string]: ReadableInstanceType;
}

interface Instance {
	readonly name: string | undefined;
	readonly pid: number | undefined;
	readonly status: ProcessStatus;
	readonly version: string;
	readonly network: NETWORK;
	// eslint-disable-next-line camelcase
	readonly started_at: string;
	readonly cpu?: number;
	readonly memory?: number;
	readonly dbPort: string;
	readonly redisPort: string;
	readonly wsPort: string;
	readonly httpPort: string;
	readonly installationPath: string;
}

export type PM2ProcessInstance = Instance & InstanceIndex;

const connectPM2 = async (): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		connect(err => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (err) {
				reject(err);

				return;
			}
			resolve();
		});
	});

const startPM2 = async (
	installPath: string,
	network: NETWORK,
	name: string,
	envConfig: object,
): Promise<void> => {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const { apps } = await fsExtra.readJson(`${installPath}/etc/pm2-lisk.json`);

	return new Promise<void>((resolve, reject) => {
		start(
			{
				name,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
				script: apps[0].script,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
				args: apps[0].args,
				interpreter: `${installPath}/bin/node`,
				cwd: installPath,
				env: {
					LISK_NETWORK: network,
					...envConfig,
				},
				pid: path.join(installPath, '/pids/lisk.app.pid'),
				output: path.join(installPath, '/logs/lisk.app.log'),
				error: path.join(installPath, '/logs/lisk.app.err'),
				// eslint-disable-next-line camelcase
				log_date_format: 'YYYY-MM-DD HH:mm:ss SSS',
				watch: false,
				// eslint-disable-next-line camelcase
				kill_timeout: 10000,
				// eslint-disable-next-line camelcase
				max_memory_restart: '1024M',
				// eslint-disable-next-line camelcase
				min_uptime: 20000,
				// eslint-disable-next-line camelcase
				max_restarts: 10,
			},
			err => {
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (err) {
					reject(err);
					return;
				}
				resolve();
			},
		);
	});
};

const restartPM2 = async (process: string | number): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		restart(process, err => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (err && err.message !== 'process name not found') {
				reject(err.message);

				return;
			}
			resolve();
		});
	});

const stopPM2 = async (process: string | number): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		stop(process, err => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (err && err.message !== 'process name not found') {
				reject();

				return;
			}
			resolve();
		});
	});

const describePM2 = async (
	process: string | number,
): Promise<ProcessDescription> =>
	new Promise<ProcessDescription>((resolve, reject) => {
		describe(process, (err, descs) => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (err && err.message !== 'process name not found') {
				reject(err);

				return;
			}
			const pDesc = descs.find(
				desc => desc.pid === process || desc.name === process,
			);
			if (!pDesc) {
				reject(new Error(`Process ${process} not found`));
			}
			resolve(pDesc);
		});
	});

const listPM2 = async (): Promise<ReadonlyArray<ProcessDescription>> =>
	new Promise<ReadonlyArray<ProcessDescription>>((resolve, reject) => {
		list((err, res) => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (err) {
				reject(err);

				return;
			}
			resolve(res);
		});
	});

const deleteProcess = async (process: string | number): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		del(process, err => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (err) {
				reject(err);

				return;
			}
			resolve();
		});
	});

export const registerApplication = async (
	installPath: string,
	network: NETWORK,
	name: string,
	envConfig: object,
): Promise<void> => {
	await connectPM2();
	await startPM2(installPath, network, name, envConfig);
	await stopPM2(name);
	disconnect();
};

export const unRegisterApplication = async (name: string): Promise<void> => {
	await connectPM2();
	await deleteProcess(name);
	disconnect();
};

export const restartApplication = async (name: string): Promise<void> => {
	await connectPM2();
	await restartPM2(name);
	disconnect();
};

export const stopApplication = async (name: string): Promise<void> => {
	await connectPM2();
	await stopPM2(name);
	disconnect();
};

const extractProcessDetails = (
	appDesc: ProcessDescription,
): PM2ProcessInstance => {
	// eslint-disable-next-line camelcase
	const { pm2_env, monit, name, pid } = appDesc;
	const {
		status,
		// eslint-disable-next-line camelcase
		pm_uptime,
		pm_cwd: installationPath,
		version,
		LISK_NETWORK: network,
		LISK_DB_PORT: dbPort,
		LISK_REDIS_PORT: redisPort,
		LISK_HTTP_PORT: httpPort,
		LISK_WS_PORT: wsPort,
		// eslint-disable-next-line camelcase
	} = pm2_env as Pm2Env;

	return {
		name,
		pid,
		status,
		version,
		network,
		dbPort,
		redisPort,
		httpPort,
		wsPort,
		installationPath,
		// eslint-disable-next-line camelcase
		started_at: new Date(pm_uptime).toLocaleString(),
		...monit,
	};
};

export const listApplication = async (): Promise<ReadonlyArray<
	PM2ProcessInstance
>> => {
	await connectPM2();
	const applications = (await listPM2()) as ReadonlyArray<PM2ProcessInstance>;
	disconnect();

	return applications.map(extractProcessDetails);
};

export const describeApplication = async (
	name: string,
): Promise<PM2ProcessInstance | undefined> => {
	try {
		await connectPM2();
		const application = await describePM2(name);
		disconnect();

		return extractProcessDetails(application);
	} catch (error) {
		disconnect();

		return undefined;
	}
};
