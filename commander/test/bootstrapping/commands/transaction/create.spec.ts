/*
 * Copyright © 2021 Lisk Foundation
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
 *
 */
import * as inquirer from 'inquirer';
import { Application, transactionSchema } from 'lisk-framework';
import * as cryptography from '@liskhq/lisk-cryptography';
import * as apiClient from '@liskhq/lisk-api-client';
import * as transactions from '@liskhq/lisk-transactions';

import { emptySchema } from '@liskhq/lisk-codec';
import { join } from 'path';
import * as appUtils from '../../../../src/utils/application';
import * as readerUtils from '../../../../src/utils/reader';
import {
	tokenTransferParamsSchema,
	posVoteParamsSchema,
	schemaWithArray,
	schemaWithArrayOfObjects,
} from '../../../helpers/transactions';
import { CreateCommand } from '../../../../src/bootstrapping/commands/transaction/create';
import { getConfig } from '../../../helpers/config';
import { PromiseResolvedType } from '../../../../src/types';
import { Awaited } from '../../../types';

describe('transaction:create command', () => {
	const passphrase = 'peanut hundred pen hawk invite exclude brain chunk gadget wait wrong ready';
	const transferParams =
		'{"tokenID": "0000000000000000","amount":100,"recipientAddress":"lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9","data":"send token"}';
	const voteParams =
		'{"stakes":[{"validatorAddress":"lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9","amount":100},{"validatorAddress":"lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9","amount":-50}]}';
	const unVoteParams =
		'{"stakes":[{"validatorAddress":"lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9","amount":-50}]}';
	const { publicKey } = cryptography.legacy.getPrivateAndPublicKeyFromPassphrase(passphrase);
	const senderPublicKey = publicKey.toString('hex');
	const mockEncodedTransaction = Buffer.from('encoded transaction');
	const mockJSONTransaction = {
		params: {
			tokenID: '0000000000000000',
			amount: '100',
			data: 'send token',
			recipientAddress: 'lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9',
		},
		command: 'transfer',
		fee: '100000000',
		module: 'token',
		nonce: 'transfer',
		senderPublicKey: '31048f87ca35a00a553633dd03c788d4b82ea9caf6ccc36315cf8e595f3e7a83',
		signatures: [
			'3cc8c8c81097fe59d9df356b3c3f1dd10f619bfabb54f5d187866092c67e0102c64dbe24f357df493cc7ebacdd2e55995db8912245b718d88ebf7f4f4ac01f04',
		],
	};

	const questionsForTokenTransfer = [
		{ message: 'Please enter: tokenID: ', name: 'tokenID', type: 'input' },
		{ message: 'Please enter: amount: ', name: 'amount', type: 'input' },
		{
			message: 'Please enter: recipientAddress: ',
			name: 'recipientAddress',
			type: 'input',
		},
		{ message: 'Please enter: data: ', name: 'data', type: 'input' },
	];

	const verifyIfInquirerCallsFor = (questions: Array<Record<string, unknown>>) => {
		expect(inquirer.prompt).toHaveBeenCalledTimes(questions.length);
		for (let i = 0; i < 1; i += 1) {
			expect(inquirer.prompt).toHaveBeenNthCalledWith(i + 1, questions[i]);
		}
	};

	let config: Awaited<ReturnType<typeof getConfig>>;
	let clientMock: PromiseResolvedType<ReturnType<typeof apiClient.createIPCClient>>;

	// In order to test the command we need to extended the base crete command and provide application implementation
	class CreateCommandExtended extends CreateCommand {
		getApplication = () => {
			const { app } = Application.defaultApplication({ genesis: { chainID: '00000000' } });
			return app;
		};
	}

	beforeEach(async () => {
		config = await getConfig();
		jest.spyOn(appUtils, 'isApplicationRunning').mockReturnValue(true);
		jest.spyOn(CreateCommandExtended.prototype, 'printJSON').mockReturnValue();
		clientMock = {
			disconnect: jest.fn(),
			schema: {
				transaction: transactionSchema,
			},
			metadata: [
				{
					name: 'token',
					commands: [
						{
							name: 'transfer',
							params: tokenTransferParamsSchema,
						},
					],
				},
				{
					name: 'pos',
					commands: [
						{
							name: 'stake',
							params: posVoteParamsSchema,
						},
						{
							name: 'unlock',
							params: emptySchema,
						},
					],
				},
				{
					name: 'nft',
					commands: [
						{
							name: 'arrayOfItems',
							params: schemaWithArray,
						},
						{
							name: 'arrayOfObjects',
							params: schemaWithArrayOfObjects,
						},
					],
				},
			],
			node: {
				getNodeInfo: jest.fn().mockResolvedValue({
					chainID: '10000000',
				}),
			},
			transaction: {
				encode: jest.fn().mockReturnValue(mockEncodedTransaction),
				toJSON: jest.fn().mockReturnValue(mockJSONTransaction),
				sign: jest.fn().mockReturnValue(mockJSONTransaction),
			},
			invoke: jest.fn().mockResolvedValue({
				nonce: BigInt(0),
				numberOfSignatures: 0,
				mandatoryKeys: [],
				optionalKeys: [],
			}),
		} as any;
		jest.spyOn(apiClient, 'createIPCClient').mockResolvedValue(clientMock);
		jest.spyOn(inquirer, 'prompt').mockResolvedValue({
			tokenID: '0000000000000000',
			amount: 100,
			recipientAddress: 'lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9',
			data: 'send token',
		});
		jest.spyOn(readerUtils, 'getPassphraseFromPrompt').mockResolvedValue(passphrase);
	});

	describe('transaction:create', () => {
		it('should throw an error when no arguments are provided.', async () => {
			await expect(CreateCommandExtended.run([], config)).rejects.toThrow(
				'Missing 3 required args:',
			);
		});

		it('should throw if casting fails', async () => {
			jest.spyOn(inquirer, 'prompt').mockResolvedValue({
				attributesArray: 'a,12312321',
			});

			await expect(
				CreateCommandExtended.run(
					['nft', 'arrayOfItems', '100000000', `--passphrase=${passphrase}`],
					config,
				),
			).rejects.toThrow();
		});

		describe('prompt for arrays and array of objects', () => {
			it('should inquire arrays as CSV', async () => {
				jest.spyOn(inquirer, 'prompt').mockResolvedValue({
					attributesArray: '13213213,12312321',
				});

				await CreateCommandExtended.run(
					['nft', 'arrayOfItems', '100000000', `--passphrase=${passphrase}`],
					config,
				);
				verifyIfInquirerCallsFor([
					{
						type: 'input',
						name: 'attributesArray',
						message: 'Please enter: attributesArray(comma separated values (a,b)): ',
					},
				]);

				expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
			});

			it('should inquire each item of the array as a CSV and prompt to add more', async () => {
				jest
					.spyOn(inquirer, 'prompt')
					.mockResolvedValueOnce({
						attributesArray: 'pos, 0000',
					})
					.mockResolvedValueOnce({
						askAgain: true,
					})
					.mockResolvedValueOnce({
						attributesArray: 'token, 0000',
					})
					.mockResolvedValue({
						askAgain: false,
					});

				await CreateCommandExtended.run(
					['nft', 'arrayOfObjects', '100000000', `--passphrase=${passphrase}`],
					config,
				);

				verifyIfInquirerCallsFor([
					{
						type: 'input',
						name: 'attributesArray',
						message: 'Please enter: attributesArray(module,attributes): ',
					},
					{
						type: 'confirm',
						name: 'askAgain',
						message: 'Want to enter another attributesArray',
					},
					{
						type: 'input',
						name: 'attributesArray',
						message: 'Please enter: attributesArray(module,attributes): ',
					},
					{
						type: 'confirm',
						name: 'askAgain',
						message: 'Want to enter another attributesArray',
					},
				]);

				expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe('transaction:create 2', () => {
		it('should throw an error when fee, nonce and transaction type are provided.', async () => {
			await expect(CreateCommandExtended.run(['token'], config)).rejects.toThrow(
				'Missing 2 required args:',
			);
		});
	});

	describe('transaction:create token transfer', () => {
		it('should throw an error when nonce and transaction type are provided.', async () => {
			await expect(CreateCommandExtended.run(['token', 'transfer'], config)).rejects.toThrow(
				'Missing 1 required arg:',
			);
		});
	});

	describe('transaction:create 9999 0000 100000000', () => {
		it('should throw an error when module is not registered.', async () => {
			await expect(
				CreateCommandExtended.run(['newMod', 'transfer', '100000000'], config),
			).rejects.toThrow('Module: newMod is not registered');
		});
	});

	describe('offline', () => {
		describe('with flags', () => {
			describe(`transaction:create token transfer 100000000 --params='{"amount": "abc"}' --passphrase=${passphrase} --offline`, () => {
				it('should throw error for data path flag.', async () => {
					await expect(
						CreateCommandExtended.run(
							[
								'token',
								'transfer',
								'100000000',
								'--params={"amount": "abc"}',
								`--passphrase=${passphrase}`,
								'--offline',
								'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
								'--nonce=1',
								'--data-path=/tmp',
							],
							config,
						),
					).rejects.toThrow('--data-path=/tmp cannot also be provided when using --offline');
				});
			});

			describe(`transaction:create token transfer 100000000 --params='{"amount": "abc"}' --passphrase=${passphrase} --offline`, () => {
				it('should throw error for missing network identifier flag.', async () => {
					await expect(
						CreateCommandExtended.run(
							[
								'token',
								'transfer',
								'100000000',
								'--params={"amount": "abc"}',
								`--passphrase=${passphrase}`,
								'--offline',
							],
							config,
						),
					).rejects.toThrow(
						'All of the following must be provided when using --offline: --chain-id, --nonce',
					);
				});
			});

			describe(`transaction:create token transfer 100000000 --params='{"amount": "abc"}' --passphrase=${passphrase} --offline`, () => {
				it('should throw error for missing nonce flag.', async () => {
					await expect(
						CreateCommandExtended.run(
							[
								'token',
								'transfer',
								'100000000',
								'--params={"amount": "abc"}',
								`--passphrase=${passphrase}`,
								'--offline',
								'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							],
							config,
						),
					).rejects.toThrow(
						'All of the following must be provided when using --offline: --chain-id, --nonce',
					);
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --no-signature`, () => {
				it('should throw error when sender public key not specified when no-signature flag is used.', async () => {
					await expect(
						CreateCommandExtended.run(
							[
								'token',
								'transfer',
								'100000000',
								`--params=${transferParams}`,
								'--no-signature',
								'--offline',
								'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
								'--nonce=1',
							],
							config,
						),
					).rejects.toThrow(
						'All of the following must be provided when using --no-signature: --sender-public-key',
					);
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --passphrase=${passphrase}`, () => {
				it('should throw error when transfer params data is empty.', async () => {
					await expect(
						CreateCommandExtended.run(
							[
								'token',
								'transfer',
								'100000000',
								'--params={"tokenID":"0000000000000000","amount":100,"recipientAddress":"lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9"}',
								`--passphrase=${passphrase}`,
								'--offline',
								'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
								'--nonce=1',
								'--network=devnet',
							],
							config,
						),
					).rejects.toThrow(
						"Lisk validator found 1 error[s]:\nMissing property, must have required property 'data'",
					);
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --passphrase=${passphrase}`, () => {
				it('should return encoded transaction string in hex format with signature', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							'--offline',
							`--params=${transferParams}`,
							`--passphrase=${passphrase}`,
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --no-signature --sender-public-key=${senderPublicKey}`, () => {
				it('should return encoded transaction string in hex format without signature', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							'--offline',
							`--params=${transferParams}`,
							'--no-signature',
							`--sender-public-key=${senderPublicKey}`,
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
				});
			});

			describe(`transaction:create pos stake 100000000 --params=${voteParams} --passphrase=${passphrase}`, () => {
				it('should return encoded transaction string in hex format with signature', async () => {
					await CreateCommandExtended.run(
						[
							'pos',
							'stake',
							'100000000',
							'--offline',
							`--params=${voteParams}`,
							`--passphrase=${passphrase}`,
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
				});
			});

			describe(`transaction:create pos stake 100000000 --params=${unVoteParams} --passphrase=${passphrase}`, () => {
				it('should return encoded transaction string in hex format with signature', async () => {
					await CreateCommandExtended.run(
						[
							'pos',
							'stake',
							'100000000',
							'--offline',
							`--params=${unVoteParams}`,
							`--passphrase=${passphrase}`,
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
				});
			});

			describe(`transaction:create token transfer 0 --nonce 600 --chain-id 04000001 --offline`, () => {
				it('should not throw', async () => {
					await expect(
						CreateCommandExtended.run(
							['token', 'transfer', '0', '--offline', '--chain-id=04000001', '--nonce=600'],
							config,
						),
					).resolves.toBeUndefined();
				});

				it('should successfully create transaction', async () => {
					await CreateCommandExtended.run(
						['token', 'transfer', '0', '--offline', '--chain-id=04000001', '--nonce=600'],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
				});
			});
		});

		describe('with prompts and flags', () => {
			describe(`transaction:create token transfer 100000000 --passphrase=${passphrase}`, () => {
				it('should prompt user for params.', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							`--passphrase=${passphrase}`,
							'--offline',
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					verifyIfInquirerCallsFor(questionsForTokenTransfer);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
				});
			});

			describe('transaction:create token transfer 100000000', () => {
				it('should prompt user for params and passphrase.', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							'--offline',
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					verifyIfInquirerCallsFor(questionsForTokenTransfer);
					expect(readerUtils.getPassphraseFromPrompt).toHaveBeenCalledWith('passphrase');
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --no-signature --json`, () => {
				it('should return unsigned transaction in json format when no passphrase specified', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							`--params=${transferParams}`,
							'--no-signature',
							`--sender-public-key=${senderPublicKey}`,
							'--json',
							'--offline',
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(2);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: {
							module: 'token',
							command: 'transfer',
							nonce: '1',
							fee: '100000000',
							senderPublicKey,
							params: {
								tokenID: '0000000000000000',
								amount: '100',
								data: 'send token',
								recipientAddress: 'lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9',
							},
							signatures: [],
						},
					});
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --passphrase=${passphrase} --json`, () => {
				it('should return signed transaction in json format when passphrase specified', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							`--params=${transferParams}`,
							`--passphrase=${passphrase}`,
							'--json',
							'--offline',
							'--chain-id=873da85a2cee70da631d90b0f17fada8c3ac9b83b2613f4ca5fddd374d1034b3.',
							'--nonce=1',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(2);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: expect.any(String),
					});
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: {
							module: 'token',
							command: 'transfer',
							nonce: '1',
							fee: '100000000',
							id: expect.any(String),
							senderPublicKey: '31048f87ca35a00a553633dd03c788d4b82ea9caf6ccc36315cf8e595f3e7a83',
							params: {
								tokenID: '0000000000000000',
								amount: '100',
								data: 'send token',
								recipientAddress: 'lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9',
							},
							signatures: [expect.any(String)],
						},
					});
				});
			});
		});
	});

	describe('online', () => {
		describe('with flags', () => {
			describe(`transaction:create token transfer 100000000 --params='{"amount": "abc"}' --passphrase=${passphrase}`, () => {
				it('should throw error for invalid params.', async () => {
					await expect(
						CreateCommandExtended.run(
							[
								'token',
								'transfer',
								'100000000',
								'--params={"amount": "abc"}',
								`--passphrase=${passphrase}`,
							],
							config,
						),
					).rejects.toThrow('Cannot convert abc to a BigInt');
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --passphrase=${passphrase}`, () => {
				it('should return encoded transaction string in hex format with signature', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							`--params=${transferParams}`,
							`--passphrase=${passphrase}`,
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --no-signature --sender-public-key=${senderPublicKey}`, () => {
				it('should return encoded transaction string in hex format without signature', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							`--params=${transferParams}`,
							'--no-signature',
							`--sender-public-key=${senderPublicKey}`,
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe(`transaction:create pos stake 100000000 --params=${voteParams} --passphrase=${passphrase}`, () => {
				it('should return encoded transaction string in hex format with signature', async () => {
					await CreateCommandExtended.run(
						['pos', 'stake', '100000000', `--params=${voteParams}`, `--passphrase=${passphrase}`],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe(`transaction:create pos stake 100000000 --params=${unVoteParams} --passphrase=${passphrase}`, () => {
				it('should return encoded transaction string in hex format with signature', async () => {
					await CreateCommandExtended.run(
						['pos', 'stake', '100000000', `--params=${unVoteParams}`, `--passphrase=${passphrase}`],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe(`transaction:create pos unlock 100000000 --passphrase=${passphrase}`, () => {
				it('should return encoded transaction string in hex format with signature', async () => {
					await CreateCommandExtended.run(
						['pos', 'unlock', '100000000', `--passphrase=${passphrase}`],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe('create and send using --send flag', () => {
				const pathToAppPIDFiles = join(__dirname, 'fake_test_app');

				it('should return encoded transaction string in hex format with signature and invoke send command', async () => {
					const stdout: string[] = [];
					jest
						.spyOn(process.stdout, 'write')
						.mockImplementation(val => stdout.push(val as string) > -1);

					await CreateCommandExtended.run(
						['pos', 'unlock', '100000000', `--passphrase=${passphrase}`, '--send'],
						config,
					);

					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
					expect(stdout[0]).toContain(`Transaction with id: 'undefined' received by node`);
				});

				it('should invoke send command when --send flag is provided', async () => {
					await CreateCommandExtended.run(
						[
							'pos',
							'unlock',
							'100000000',
							`--passphrase=${passphrase}`,
							'--send',
							`--data-path=${pathToAppPIDFiles}`,
						],
						config,
					);

					expect(clientMock.invoke).toHaveBeenCalledTimes(2);
					expect(clientMock.invoke).toHaveBeenCalledWith('txpool_postTransaction', {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});

				it('should throw an error when the application for the provided path is not running.', async () => {
					jest.spyOn(appUtils, 'isApplicationRunning').mockReturnValue(false);
					await expect(
						CreateCommandExtended.run(
							[
								'pos',
								'unlock',
								'100000000',
								`--passphrase=${passphrase}`,
								'--send',
								`--data-path=${pathToAppPIDFiles}`,
							],
							config,
						),
					).rejects.toThrow(`Application at data path ${pathToAppPIDFiles} is not running.`);
				});
			});
		});

		describe('with prompts and flags', () => {
			describe(`transaction:create token transfer 100000000 --passphrase=${passphrase}`, () => {
				it('should prompt user for params.', async () => {
					await CreateCommandExtended.run(
						['token', 'transfer', '100000000', `--passphrase=${passphrase}`],
						config,
					);
					verifyIfInquirerCallsFor(questionsForTokenTransfer);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe('transaction:create token transfer 100000000 --nonce=999', () => {
				it('should prompt user for params and passphrase.', async () => {
					await CreateCommandExtended.run(
						['token', 'transfer', '100000000', '--nonce=999'],
						config,
					);
					verifyIfInquirerCallsFor(questionsForTokenTransfer);
					expect(readerUtils.getPassphraseFromPrompt).toHaveBeenCalledWith('passphrase');
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe('transaction:create token transfer 100000000', () => {
				it('should prompt user for params and passphrase.', async () => {
					await CreateCommandExtended.run(['token', 'transfer', '100000000'], config);
					verifyIfInquirerCallsFor(questionsForTokenTransfer);
					expect(readerUtils.getPassphraseFromPrompt).toHaveBeenCalledWith('passphrase');
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(1);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: mockEncodedTransaction.toString('hex'),
					});
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --no-signature --json`, () => {
				it('should return unsigned transaction in json format when no passphrase specified', async () => {
					jest.spyOn(transactions, 'signTransaction');
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							`--params=${transferParams}`,
							'--no-signature',
							`--sender-public-key=${senderPublicKey}`,
							'--json',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(2);
					expect(transactions.signTransaction).not.toHaveBeenCalled();
				});
			});

			describe(`transaction:create token transfer 100000000 --params=${transferParams} --passphrase=${passphrase} --json`, () => {
				it('should return signed transaction in json format when passphrase specified', async () => {
					await CreateCommandExtended.run(
						[
							'token',
							'transfer',
							'100000000',
							`--params=${transferParams}`,
							`--passphrase=${passphrase}`,
							'--json',
						],
						config,
					);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledTimes(2);
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: '656e636f646564207472616e73616374696f6e',
					});
					expect(CreateCommandExtended.prototype.printJSON).toHaveBeenCalledWith(undefined, {
						transaction: {
							module: 'token',
							command: 'transfer',
							nonce: 'transfer',
							fee: '100000000',
							senderPublicKey: '31048f87ca35a00a553633dd03c788d4b82ea9caf6ccc36315cf8e595f3e7a83',
							params: {
								tokenID: '0000000000000000',
								amount: '100',
								data: 'send token',
								recipientAddress: 'lskqozpc4ftffaompmqwzd93dfj89g5uezqwhosg9',
							},
							signatures: [
								'3cc8c8c81097fe59d9df356b3c3f1dd10f619bfabb54f5d187866092c67e0102c64dbe24f357df493cc7ebacdd2e55995db8912245b718d88ebf7f4f4ac01f04',
							],
						},
					});
				});
			});
		});
	});
});
