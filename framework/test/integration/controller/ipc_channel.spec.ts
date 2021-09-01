/*
 * Copyright © 2019 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import { homedir } from 'os';
import { removeSync, mkdirSync } from 'fs-extra';
import { resolve as pathResolve } from 'path';
import { IPCChannel, InMemoryChannel } from '../../../src/controller/channels';
import { Bus } from '../../../src/controller/bus';
import { IPCServer } from '../../../src/controller/ipc/ipc_server';

describe('IPCChannel', () => {
	// Arrange
	const logger: any = {
		info: jest.fn(),
		debug: jest.fn(),
		error: jest.fn(),
	};

	const socketsDir = pathResolve(`${homedir()}/.lisk/integration/ipc_channel/sockets`);

	const config: any = {
		socketsPath: socketsDir,
		rpc: {
			modes: [''],
			ipc: {
				path: socketsDir,
			},
		},
	};

	const alpha = {
		moduleAlias: 'alphaAlias',
		events: ['alpha1', 'alpha2'],
		actions: {
			multiplyByTwo: {
				handler: (params: any) => params.val * 2,
			},
			multiplyByThree: {
				handler: (params: any) => params.val * 3,
			},
		},
	};

	const beta = {
		moduleAlias: 'betaAlias',
		events: ['beta1', 'beta2', 'beta3'],
		actions: {
			divideByTwo: {
				handler: (params: any) => params.val / 2,
			},
			divideByThree: {
				handler: (params: any) => params.val / 3,
			},
			withError: {
				handler: (params: any) => {
					if (params.val === 1) {
						throw new Error('Invalid request');
					}
					return 0;
				},
			},
		},
	};

	describe('after registering itself to the bus', () => {
		let alphaChannel: IPCChannel;
		let betaChannel: IPCChannel;
		let bus: Bus;

		beforeAll(async () => {
			mkdirSync(socketsDir, { recursive: true });

			const internalIPCServer = new IPCServer({
				socketsDir,
				name: 'bus',
				externalSocket: false,
			});

			config['internalIPCServer'] = internalIPCServer;
			// Arrange
			bus = new Bus(logger, config);

			alphaChannel = new IPCChannel(alpha.moduleAlias, alpha.events, alpha.actions, config);

			betaChannel = new IPCChannel(beta.moduleAlias, beta.events, beta.actions, config);

			await bus.init();
			await alphaChannel.registerToBus();
			await betaChannel.registerToBus();
		});

		afterAll(async () => {
			alphaChannel.cleanup();
			betaChannel.cleanup();
			await bus.cleanup();

			removeSync(socketsDir);
		});

		describe('#subscribe', () => {
			it('should be able to subscribe to an event.', async () => {
				// Arrange
				const betaEventData = { data: '#DATA' };
				const eventName = beta.events[0];
				let message = '';
				// Act
				const listen = async () => {
					return new Promise<void>(resolve => {
						alphaChannel.subscribe(`${beta.moduleAlias}:${eventName}`, data => {
							message = data;
							resolve();
						});

						betaChannel.publish(`${beta.moduleAlias}:${eventName}`, betaEventData);
					});
				};

				await listen();
				// Assert
				expect(message).toEqual(betaEventData);
			});

			it('should be able to subscribe to an event once.', async () => {
				// Arrange
				const betaEventData = { data: '#DATA' };
				const eventName = beta.events[0];
				const donePromise = new Promise<void>(resolve => {
					// Act
					alphaChannel.once(`${beta.moduleAlias}:${eventName}`, data => {
						// Assert
						expect(data).toEqual(betaEventData);
						resolve();
					});
				});

				betaChannel.publish(`${beta.moduleAlias}:${eventName}`, betaEventData);

				return donePromise;
			});

			it('should be able to subscribe to an unregistered event.', async () => {
				// Arrange
				const omegaEventName = 'omegaEventName';
				const omegaAlias = 'omegaAlias';
				const dummyData = { data: '#DATA' };
				const inMemoryChannelOmega = new InMemoryChannel(omegaAlias, [omegaEventName], {});

				const donePromise = new Promise<void>(resolve => {
					// Act
					alphaChannel.subscribe(`${omegaAlias}:${omegaEventName}`, data => {
						// Assert
						expect(data).toEqual(dummyData);
						resolve();
					});
				});

				await inMemoryChannelOmega.registerToBus(bus);

				inMemoryChannelOmega.publish(`${omegaAlias}:${omegaEventName}`, dummyData);

				return donePromise;
			});
		});

		describe('#unsubscribe', () => {
			it('should be able to unsubscribe to an event.', async () => {
				// Arrange
				const betaEventData = { data: '#DATA' };
				const eventName = beta.events[2];
				let messageCount = 0;
				const wait = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
				// Act
				const listenPromise = new Promise<void>(resolve => {
					alphaChannel.subscribe(`${beta.moduleAlias}:${eventName}`, _ => {
						messageCount += 1;
					});
					setTimeout(() => {
						expect(messageCount).toEqual(1);
						resolve();
					}, 200);
				});

				betaChannel.publish(`${beta.moduleAlias}:${eventName}`, betaEventData);
				await wait(25);
				// Now unsubscribe from the event and publish it again
				alphaChannel.unsubscribe(`${beta.moduleAlias}:${eventName}`, _ => {});
				await wait(25);
				betaChannel.publish(`${beta.moduleAlias}:${eventName}`, betaEventData);

				// Assert
				return listenPromise;
			});
		});

		describe('#publish', () => {
			it('should be able to publish an event.', async () => {
				// Arrange
				const alphaEventData = { data: '#DATA' };
				const eventName = alpha.events[0];

				const donePromise = new Promise<void>(done => {
					// Act
					betaChannel.once(`${alpha.moduleAlias}:${eventName}`, data => {
						// Assert
						expect(data).toEqual(alphaEventData);
						done();
					});
				});

				alphaChannel.publish(`${alpha.moduleAlias}:${eventName}`, alphaEventData);

				return donePromise;
			});
		});

		describe('#invoke', () => {
			it('should be able to invoke its own actions.', async () => {
				// Act && Assert
				await expect(
					alphaChannel.invoke<number>(`${alpha.moduleAlias}:multiplyByTwo`, {
						val: 2,
					}),
				).resolves.toBe(4);

				await expect(
					alphaChannel.invoke<number>(`${alpha.moduleAlias}:multiplyByThree`, {
						val: 4,
					}),
				).resolves.toBe(12);
			});

			it("should be able to invoke other channels' actions.", async () => {
				// Act && Assert
				await expect(
					alphaChannel.invoke<number>(`${beta.moduleAlias}:divideByTwo`, {
						val: 4,
					}),
				).resolves.toEqual(2);

				await expect(
					alphaChannel.invoke<number>(`${beta.moduleAlias}:divideByThree`, {
						val: 9,
					}),
				).resolves.toEqual(3);
			});

			it('should throw error when trying to invoke an invalid action.', async () => {
				// Arrange
				const invalidActionName = 'INVALID_ACTION_NAME';

				// Act && Assert
				await expect(
					alphaChannel.invoke(`${beta.moduleAlias}:${invalidActionName}`),
				).rejects.toThrow(
					`Action name "${beta.moduleAlias}:${invalidActionName}" must be a valid name with module name and action name.`,
				);
			});

			// eslint-disable-next-line jest/no-disabled-tests
			it.skip('should be rejected with error', async () => {
				await expect(
					await alphaChannel.invoke(`${beta.moduleAlias}:withError`, { val: 1 }),
				).rejects.toThrow('Invalid Request');
			});
		});
	});
});
