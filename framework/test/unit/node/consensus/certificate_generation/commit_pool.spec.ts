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
 */

import { InMemoryKVStore, NotFoundError } from '@liskhq/lisk-db';
import { BlockHeader } from '@liskhq/lisk-chain';
import { codec } from '@liskhq/lisk-codec';
import {
	createAggSig,
	generatePrivateKey,
	getPublicKeyFromPrivateKey,
	getRandomBytes,
	signBLS,
} from '@liskhq/lisk-cryptography';
import * as crypto from '@liskhq/lisk-cryptography';
import { when } from 'jest-when';
import { BFTParameterNotFoundError } from '../../../../../src/node/bft/errors';
import { CommitPool } from '../../../../../src/node/consensus/certificate_generation/commit_pool';
import {
	COMMIT_RANGE_STORED,
	MESSAGE_TAG_CERTIFICATE,
	NETWORK_EVENT_COMMIT_MESSAGES,
} from '../../../../../src/node/consensus/certificate_generation/constants';
import {
	certificateSchema,
	singleCommitSchema,
	singleCommitsNetworkPacketSchema,
} from '../../../../../src/node/consensus/certificate_generation/schema';
import {
	Certificate,
	SingleCommit,
} from '../../../../../src/node/consensus/certificate_generation/types';
import { APIContext } from '../../../../../src/node/state_machine/types';
import { createFakeBlockHeader, createTransientAPIContext } from '../../../../../src/testing';
import {
	computeCertificateFromBlockHeader,
	signCertificate,
} from '../../../../../src/node/consensus/certificate_generation/utils';
import { AggregateCommit } from '../../../../../src/node/consensus/types';
import { createNewAPIContext } from '../../../../../src/node/state_machine/api_context';
import { COMMIT_SORT } from '../../../../../src/node/consensus/certificate_generation/commit_list';

jest.mock('@liskhq/lisk-cryptography', () => ({
	__esModule: true,
	...jest.requireActual('@liskhq/lisk-cryptography'),
}));

describe('CommitPool', () => {
	const networkIdentifier = Buffer.alloc(0);
	const networkMock = {
		send: jest.fn(),
	};

	let commitPool: CommitPool;
	let bftAPI: any;
	let blockTime: number;
	let chain: any;
	let network: any;
	let getBlockHeaderByHeight: any;

	beforeEach(() => {
		bftAPI = {
			getValidator: jest.fn(),
			getBFTHeights: jest.fn(),
			getBFTParameters: jest.fn(),
			getNextHeightBFTParameters: jest.fn(),
			selectAggregateCommit: jest.fn(),
			existBFTParameters: jest.fn(),
		};

		blockTime = 10;

		getBlockHeaderByHeight = jest.fn();

		chain = {
			networkIdentifier,
			dataAccess: {
				getBlockHeaderByHeight,
			},
		};

		network = networkMock;

		commitPool = new CommitPool({
			bftAPI,
			blockTime,
			chain,
			network,
			db: jest.fn() as any,
		});
	});

	describe('constructor', () => {
		it.todo('');
	});
	describe('job', () => {
		const dbMock = {
			get: jest.fn(),
			put: jest.fn(),
			batch: jest.fn(),
		};
		const blockID = getRandomBytes(32);
		const height = 1020;
		const maxHeightCertified = 950;
		const maxHeightPrecommitted = 1000;
		const numActiveValidators = 103;
		const staleGossipedCommit = {
			blockID,
			certificateSignature: getRandomBytes(96),
			height: maxHeightCertified - 1,
			validatorAddress: getRandomBytes(20),
		};

		const staleNonGossipedCommit = {
			blockID,
			certificateSignature: getRandomBytes(96),
			height: maxHeightCertified - 1,
			validatorAddress: getRandomBytes(20),
		};

		let nonGossipedCommits: SingleCommit[];
		let gossipedCommits: SingleCommit[];

		beforeEach(() => {
			nonGossipedCommits = Array.from({ length: 5 }, () => ({
				blockID,
				certificateSignature: getRandomBytes(96),
				height,
				validatorAddress: getRandomBytes(20),
			}));

			gossipedCommits = Array.from({ length: 5 }, () => ({
				blockID,
				certificateSignature: getRandomBytes(96),
				height,
				validatorAddress: getRandomBytes(20),
			}));

			commitPool = new CommitPool({
				bftAPI,
				blockTime,
				chain,
				network,
				db: dbMock as any,
			});

			gossipedCommits.forEach(commit => commitPool['_gossipedCommits'].add(commit));
			commitPool['_gossipedCommits'].add(staleGossipedCommit);
			// commitPool['_gossipedCommits'].set(staleGossipedCommit.height, [staleGossipedCommit]);
			nonGossipedCommits.forEach(commit => commitPool['_nonGossipedCommits'].add(commit));
			// commitPool['_nonGossipedCommits'].set(height, nonGossipedCommits);
			commitPool['_nonGossipedCommits'].add(staleNonGossipedCommit);
			(commitPool['_chain'] as any).finalizedHeight = maxHeightCertified;

			when(commitPool['_chain'].dataAccess.getBlockHeaderByHeight as any)
				.calledWith(maxHeightCertified)
				.mockResolvedValue({ aggregateCommit: { height: maxHeightCertified } } as never);

			commitPool['_bftAPI'].getBFTHeights = jest.fn().mockResolvedValue({ maxHeightPrecommitted });
			commitPool['_bftAPI'].getCurrentValidators = jest
				.fn()
				.mockResolvedValue(Array.from({ length: numActiveValidators }, () => getRandomBytes(32)));
		});

		it('should clean all the commits from nonGossipedCommit list with height below removal height', async () => {
			// Assert
			expect(commitPool['_nonGossipedCommits'].getAll()).toHaveLength(6);
			// Arrange
			commitPool['_bftAPI'].existBFTParameters = jest.fn().mockResolvedValue(true);
			const context = createNewAPIContext(new InMemoryKVStore());
			// Act
			await commitPool['_job'](context);
			// Assert
			// nonGossiped commits are moved to gossiped commits and stale commit is deleted
			expect(commitPool['_nonGossipedCommits'].getAll()).toHaveLength(0);
		});

		it('should move/delete commits in gossipedCommit list with height below removal height', async () => {
			// Assert
			expect(commitPool['_gossipedCommits'].getAll()).toHaveLength(6);
			// Arrange
			commitPool['_bftAPI'].existBFTParameters = jest.fn().mockResolvedValue(true);
			const context = createNewAPIContext(new InMemoryKVStore());
			// Act
			await commitPool['_job'](context);
			// Assert
			// nonGossiped commits are moved to gossiped commits
			expect(commitPool['_gossipedCommits'].getAll()).toHaveLength(10);
			// Should delete stale commit from gossipedList
			expect(commitPool['_gossipedCommits'].exists(staleGossipedCommit)).toBeFalse();
		});

		it('should clean all the commits from nonGossipedCommit that does not have bftParams change', async () => {
			commitPool['_nonGossipedCommits'].add({
				blockID: getRandomBytes(32),
				certificateSignature: getRandomBytes(96),
				height: 1070,
				validatorAddress: getRandomBytes(20),
			});
			commitPool['_gossipedCommits'].add({
				blockID: getRandomBytes(32),
				certificateSignature: getRandomBytes(96),
				height: 1070,
				validatorAddress: getRandomBytes(20),
			});
			// Assert
			expect(commitPool['_nonGossipedCommits'].getAll()).toHaveLength(7);
			// Arrange
			const bftParamsMock = jest.fn();
			commitPool['_bftAPI'].existBFTParameters = bftParamsMock;
			const context = createNewAPIContext(new InMemoryKVStore());
			when(bftParamsMock).calledWith(context, 1071).mockResolvedValue(false);
			when(bftParamsMock).calledWith(context, maxHeightCertified).mockResolvedValue(true);
			when(bftParamsMock)
				.calledWith(context, height + 1)
				.mockResolvedValue(true);
			// Act
			await commitPool['_job'](context);
			// Assert
			// nonGossiped commits are moved to gossiped commits
			expect(commitPool['_nonGossipedCommits'].getAll()).toHaveLength(0);
			expect(commitPool['_gossipedCommits'].getAll()).toHaveLength(10);
			expect(commitPool['_nonGossipedCommits'].getByHeight(1070)).toBeArrayOfSize(0);
			expect(commitPool['_gossipedCommits'].getByHeight(1070)).toBeArrayOfSize(0);
		});

		it('should select non gossiped commits that are created by the generator of the node', async () => {
			// Arrange
			const generatorAddress = getRandomBytes(20);
			commitPool.addCommit(
				{
					blockID: getRandomBytes(32),
					certificateSignature: getRandomBytes(96),
					height: 1070,
					validatorAddress: generatorAddress,
				},
				true,
			);
			// Added to nonGossipedCommitsLocal
			expect(commitPool['_nonGossipedCommitsLocal'].getAll()).toHaveLength(1);
			commitPool.addCommit({
				blockID: getRandomBytes(32),
				certificateSignature: getRandomBytes(96),
				height: 1070,
				validatorAddress: getRandomBytes(20),
			});
			// Assert
			expect(commitPool['_gossipedCommits'].getAll()).toHaveLength(6);
			// Arrange
			commitPool['_bftAPI'].existBFTParameters = jest.fn().mockResolvedValue(true);
			const context = createNewAPIContext(new InMemoryKVStore());
			// Act
			await commitPool['_job'](context);
			// Assert
			// nonGossiped commits are moved to gossiped commits
			expect(commitPool['_nonGossipedCommits'].getAll()).toHaveLength(0);
			expect(commitPool['_gossipedCommits'].getAll()).toHaveLength(12);
			expect(commitPool['_nonGossipedCommits'].getByHeight(1070)).toBeArrayOfSize(0);
			const commits = commitPool['_gossipedCommits'].getByHeight(1070);
			expect(commits).toBeDefined();
			expect(commits).toBeArray();
			const generatorCommit = commits?.find(c => c.validatorAddress.equals(generatorAddress));
			expect(generatorCommit).toBeDefined();
			expect(generatorCommit?.validatorAddress).toEqual(generatorAddress);
		});

		it('should not have selected commits length more than 2 * numActiveValidators', async () => {
			const maxHeightPrecommittedTest = 1090;
			const commitHeight = 980;
			const getSelectedCommits = (cp: CommitPool) => {
				const selectedCommits = [];
				const maxSelectedCommitsLength = 2 * numActiveValidators;
				const commits = cp['_getAllCommits']();

				for (const commit of commits) {
					if (selectedCommits.length >= maxSelectedCommitsLength) {
						break;
					}
					// 2.1 Choosing the commit with smaller height first
					if (commit.height < maxHeightPrecommittedTest - COMMIT_RANGE_STORED) {
						selectedCommits.push(commit);
					}
				}

				const sortedNonGossipedCommits = cp['_nonGossipedCommits'].getAll(COMMIT_SORT.DSC);
				const sortedNonGossipedCommitsLocal = cp['_nonGossipedCommitsLocal'].getAll(
					COMMIT_SORT.DSC,
				);

				for (const commit of sortedNonGossipedCommitsLocal) {
					if (selectedCommits.length >= maxSelectedCommitsLength) {
						break;
					}
					selectedCommits.push(commit);
				}
				// 2.3 Select newly received commits by others
				for (const commit of sortedNonGossipedCommits) {
					if (selectedCommits.length >= maxSelectedCommitsLength) {
						break;
					}
					selectedCommits.push(commit);
				}

				return selectedCommits.map(commit => codec.encode(singleCommitSchema, commit));
			};
			commitPool['_nonGossipedCommits']
				.getAll()
				.forEach(c => commitPool['_nonGossipedCommits'].deleteSingle(c));
			commitPool['_gossipedCommits']
				.getAll()
				.forEach(c => commitPool['_gossipedCommits'].deleteSingle(c));

			Array.from({ length: 105 }, () => ({
				blockID,
				certificateSignature: getRandomBytes(96),
				height: commitHeight,
				validatorAddress: getRandomBytes(20),
			})).forEach(c => commitPool['_nonGossipedCommits'].add(c));

			Array.from({ length: 105 }, () => ({
				blockID,
				certificateSignature: getRandomBytes(96),
				height: commitHeight,
				validatorAddress: getRandomBytes(20),
			})).forEach(c => commitPool['_gossipedCommits'].add(c));

			expect(commitPool['_nonGossipedCommits'].getAll()).toHaveLength(105);
			expect(commitPool['_gossipedCommits'].getAll()).toHaveLength(105);

			// Arrange
			commitPool['_bftAPI'].existBFTParameters = jest.fn().mockResolvedValue(true);
			commitPool['_bftAPI'].getBFTHeights = jest
				.fn()
				.mockResolvedValue({ maxHeightPrecommitted: maxHeightPrecommittedTest });
			const context = createNewAPIContext(new InMemoryKVStore());
			const selectedCommitsToGossip = getSelectedCommits(commitPool);
			// Act
			await commitPool['_job'](context);
			// Assert
			expect(selectedCommitsToGossip).toHaveLength(2 * numActiveValidators);
			expect(networkMock.send).toHaveBeenCalledWith({
				event: NETWORK_EVENT_COMMIT_MESSAGES,
				data: codec.encode(singleCommitsNetworkPacketSchema, { commits: selectedCommitsToGossip }),
			});
		});

		it('should call network send when the job runs', async () => {
			// Arrange
			commitPool['_bftAPI'].existBFTParameters = jest.fn().mockResolvedValue(true);
			const context = createNewAPIContext(new InMemoryKVStore());
			// Act
			await commitPool['_job'](context);
			// Assert
			expect(networkMock.send).toHaveBeenCalledTimes(1);
		});
	});
	describe('addCommit', () => {
		let nonGossipedCommits: SingleCommit[];
		let height: number;

		beforeEach(() => {
			const blockID = getRandomBytes(32);

			height = 1031;

			nonGossipedCommits = Array.from({ length: 1 }, () => ({
				blockID,
				certificateSignature: getRandomBytes(96),
				height,
				validatorAddress: getRandomBytes(20),
			}));

			// We add commits by .add() method because properties are readonly
			commitPool['_nonGossipedCommits'].add(nonGossipedCommits[0]);
		});

		it('should add commit successfully', () => {
			const newCommit: SingleCommit = {
				...nonGossipedCommits[0],
				certificateSignature: getRandomBytes(96),
				validatorAddress: getRandomBytes(20),
			};

			commitPool.addCommit(newCommit);

			expect(commitPool['_nonGossipedCommits'].getByHeight(height)).toEqual([
				nonGossipedCommits[0],
				newCommit,
			]);
		});

		it('should not set new single commit when it already exists', () => {
			const newCommit: SingleCommit = {
				...nonGossipedCommits[0],
			};
			jest.spyOn(commitPool['_nonGossipedCommits'], 'add');
			commitPool.addCommit(newCommit);

			expect(commitPool['_nonGossipedCommits'].add).toHaveBeenCalledTimes(0);
		});

		it('should add commit successfully for a non-existent height', () => {
			height += 1;
			const newCommit: SingleCommit = {
				...nonGossipedCommits[0],
				height,
				certificateSignature: getRandomBytes(96),
				validatorAddress: getRandomBytes(20),
			};

			commitPool.addCommit(newCommit);

			expect(commitPool['_nonGossipedCommits'].getByHeight(height)).toEqual([newCommit]);
		});
	});
	describe('validateCommit', () => {
		let apiContext: APIContext;
		let commit: SingleCommit;
		let blockHeader: BlockHeader;
		let blockHeaderOfFinalizedHeight: BlockHeader;
		let certificate: Certificate;
		let publicKey: Buffer;
		let privateKey: Buffer;
		let signature: Buffer;
		let maxHeightCertified: number;
		let maxHeightPrecommitted: number;
		let weights: number[];
		let threshold: number;
		let validators: any[];

		beforeEach(() => {
			maxHeightCertified = 1000;
			maxHeightPrecommitted = 1050;

			apiContext = createTransientAPIContext({});

			blockHeader = createFakeBlockHeader({
				height: 1031,
				timestamp: 10310,
				generatorAddress: getRandomBytes(20),
			});

			blockHeaderOfFinalizedHeight = createFakeBlockHeader({
				aggregateCommit: {
					aggregationBits: Buffer.alloc(0),
					certificateSignature: Buffer.alloc(0),
					height: 1030,
				},
			});

			certificate = computeCertificateFromBlockHeader(blockHeader);

			privateKey = generatePrivateKey(getRandomBytes(32));
			publicKey = getPublicKeyFromPrivateKey(privateKey);
			signature = signCertificate(privateKey, networkIdentifier, certificate);

			commit = {
				blockID: blockHeader.id,
				certificateSignature: signature,
				height: blockHeader.height,
				validatorAddress: blockHeader.generatorAddress,
			};

			chain.finalizedHeight = commit.height - 1;

			weights = Array.from({ length: 103 }, _ => 1);
			validators = weights.map(weight => ({
				address: getRandomBytes(20),
				bftWeight: BigInt(weight),
				blsKey: getRandomBytes(48),
			}));
			// Single commit owner must be an active validator
			validators[0] = {
				address: commit.validatorAddress,
				bftWeight: BigInt(1),
				blsKey: publicKey,
			};

			when(chain.dataAccess.getBlockHeaderByHeight)
				.calledWith(commit.height)
				.mockReturnValue(blockHeader);

			bftAPI.getBFTHeights.mockReturnValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			when(bftAPI.getBFTParameters).calledWith(apiContext, commit.height).mockReturnValue({
				certificateThreshold: threshold,
				validators,
			});

			when(bftAPI.getValidator)
				.calledWith(apiContext, commit.validatorAddress, commit.height)
				.mockReturnValue({ blsKey: publicKey });

			bftAPI.existBFTParameters.mockReturnValue(true);

			when(getBlockHeaderByHeight)
				.calledWith(chain.finalizedHeight)
				.mockReturnValue(blockHeaderOfFinalizedHeight);
		});

		it('should validate single commit successfully', async () => {
			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeTrue();
		});

		it('should return false when single commit block id is not equal to chain block id at same height', async () => {
			when(chain.dataAccess.getBlockHeaderByHeight)
				.calledWith(commit.height)
				.mockReturnValue(createFakeBlockHeader({ id: getRandomBytes(32) }));

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeFalse();
		});

		it('should return false when single commit exists in gossiped commits but not in non-gossipped commits', async () => {
			commitPool['_gossipedCommits'].add(commit);

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeFalse();
		});

		it('should return false when single commit exists in non-gossiped commits but not in gossipped commits', async () => {
			commitPool['_nonGossipedCommits'].add(commit);

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeFalse();
		});

		it('should return false when maxRemovalHeight is equal to single commit height', async () => {
			(blockHeaderOfFinalizedHeight.aggregateCommit.height as any) = 1031;

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeFalse();
		});

		it('should return false when maxRemovalHeight is above single commit height', async () => {
			(blockHeaderOfFinalizedHeight.aggregateCommit.height as any) = 1032;

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeFalse();
		});

		it('should return true when single commit height is below commit range but bft parameter exists for next height', async () => {
			maxHeightCertified = commit.height - 50 + COMMIT_RANGE_STORED + 1;
			maxHeightPrecommitted = commit.height + COMMIT_RANGE_STORED + 1;

			bftAPI.getBFTHeights.mockReturnValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeTrue();
		});

		it('should return true when single commit height is above maxHeightPrecommited but bft parameter exists for next height', async () => {
			maxHeightCertified = commit.height - 50 - 1;
			maxHeightPrecommitted = commit.height - 1;

			bftAPI.getBFTHeights.mockReturnValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeTrue();
		});

		it('should return true when bft parameter does not exist for next height but commit in range', async () => {
			when(bftAPI.existBFTParameters)
				.calledWith(apiContext, commit.height + 1)
				.mockReturnValue(false);

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeTrue();
		});

		it('should return false when bft parameter does not exist for next height and commit is below range', async () => {
			maxHeightCertified = commit.height - 50 + COMMIT_RANGE_STORED + 1;
			maxHeightPrecommitted = commit.height + COMMIT_RANGE_STORED + 1;

			bftAPI.getBFTHeights.mockReturnValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			when(bftAPI.existBFTParameters)
				.calledWith(apiContext, commit.height + 1)
				.mockReturnValue(false);

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeFalse();
		});

		it('should return false when bft parameter does not exist for next height and single commit height is above maxHeightPrecommited', async () => {
			maxHeightCertified = commit.height - 50 - 1;
			maxHeightPrecommitted = commit.height - 1;

			bftAPI.getBFTHeights.mockReturnValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			when(bftAPI.existBFTParameters)
				.calledWith(apiContext, commit.height + 1)
				.mockReturnValue(false);

			const isCommitValid = await commitPool.validateCommit(apiContext, commit);

			expect(isCommitValid).toBeFalse();
		});

		it('should throw error when generator is not in active validators of the height', async () => {
			// Change generator to another random validator
			validators[0] = {
				address: getRandomBytes(20),
				bftWeight: BigInt(1),
			};

			await expect(commitPool.validateCommit(apiContext, commit)).rejects.toThrow(
				'Commit validator was not active for its height.',
			);
		});

		it('should throw error when bls key of the validator is not matching with the certificate signature', async () => {
			when(bftAPI.getValidator)
				.calledWith(apiContext, commit.validatorAddress, commit.height)
				.mockReturnValue({ blsKey: getRandomBytes(48) });

			await expect(commitPool.validateCommit(apiContext, commit)).rejects.toThrow(
				'Certificate signature is not valid.',
			);
		});
	});
	describe('getCommitsByHeight', () => {
		let nonGossipedCommits: SingleCommit[];
		let gossipedCommits: SingleCommit[];
		let height: number;

		beforeEach(() => {
			const blockID = getRandomBytes(32);

			height = 1031;

			nonGossipedCommits = Array.from({ length: 1 }, () => ({
				blockID,
				certificateSignature: getRandomBytes(96),
				height,
				validatorAddress: getRandomBytes(20),
			}));

			gossipedCommits = Array.from({ length: 1 }, () => ({
				blockID,
				certificateSignature: getRandomBytes(96),
				height,
				validatorAddress: getRandomBytes(20),
			}));

			// We add commits by .set() method because properties are readonly
			commitPool['_nonGossipedCommits'].add(nonGossipedCommits[0]);
			commitPool['_gossipedCommits'].add(gossipedCommits[0]);
		});

		it('should get commits by height successfully', () => {
			const commitsByHeight = commitPool.getCommitsByHeight(height);

			expect(commitsByHeight).toEqual([...nonGossipedCommits, ...gossipedCommits]);
		});

		it('should return empty array for an empty height', () => {
			const commitsByHeight = commitPool.getCommitsByHeight(height + 1);

			expect(commitsByHeight).toEqual([]);
		});

		it('should return just gossiped commits when just gossiped commits set for that height', () => {
			height = 1032;
			gossipedCommits = Array.from({ length: 1 }, () => ({
				blockID: getRandomBytes(32),
				certificateSignature: getRandomBytes(96),
				height,
				validatorAddress: getRandomBytes(20),
			}));
			commitPool['_gossipedCommits'].add(gossipedCommits[0]);

			const commitsByHeight = commitPool.getCommitsByHeight(height);

			expect(commitsByHeight).toEqual([...gossipedCommits]);
		});

		it('should return just non-gossiped commits when just non-gossiped commits set for that height', () => {
			height = 1032;
			nonGossipedCommits = Array.from({ length: 1 }, () => ({
				blockID: getRandomBytes(32),
				certificateSignature: getRandomBytes(96),
				height,
				validatorAddress: getRandomBytes(20),
			}));
			commitPool['_nonGossipedCommits'].add(nonGossipedCommits[0]);

			const commitsByHeight = commitPool.getCommitsByHeight(height);

			expect(commitsByHeight).toEqual([...nonGossipedCommits]);
		});
	});

	describe('createSingleCommit', () => {
		const blockHeader = createFakeBlockHeader();
		const validatorInfo = {
			address: getRandomBytes(20),
			blsPublicKey: getRandomBytes(48),
			blsSecretKey: getRandomBytes(32),
		};
		const certificate = computeCertificateFromBlockHeader(blockHeader);
		let expectedCommit: SingleCommit;

		beforeEach(() => {
			expectedCommit = {
				blockID: blockHeader.id,
				height: blockHeader.height,
				validatorAddress: validatorInfo.address,
				certificateSignature: signCertificate(
					validatorInfo.blsSecretKey,
					networkIdentifier,
					certificate,
				),
			};
		});

		it('should create a single commit', () => {
			expect(commitPool.createSingleCommit(blockHeader, validatorInfo, networkIdentifier)).toEqual(
				expectedCommit,
			);
		});
	});

	describe('verifyAggregateCommit', () => {
		let height: number;
		let maxHeightCertified: number;
		let maxHeightPrecommitted: number;
		let timestamp: number;
		let apiContext: APIContext;
		let aggregateCommit: AggregateCommit;
		let certificate: Certificate;
		let keysList: Buffer[];
		let privateKeys: Buffer[];
		let publicKeys: Buffer[];
		let weights: number[];
		let threshold: number;
		let signatures: Buffer[];
		let pubKeySignaturePairs: { publicKey: Buffer; signature: Buffer }[];
		let aggregateSignature: Buffer;
		let aggregationBits: Buffer;
		let validators: any;
		let blockHeader: BlockHeader;

		beforeEach(() => {
			height = 1030;
			maxHeightCertified = 1000;
			maxHeightPrecommitted = 1050;
			timestamp = 10300;

			blockHeader = createFakeBlockHeader({
				height,
				timestamp,
			});

			apiContext = createTransientAPIContext({});

			privateKeys = Array.from({ length: 103 }, _ => generatePrivateKey(getRandomBytes(32)));
			publicKeys = privateKeys.map(priv => getPublicKeyFromPrivateKey(priv));

			keysList = [...publicKeys];
			weights = Array.from({ length: 103 }, _ => 1);
			threshold = 33;

			certificate = {
				blockID: blockHeader.id,
				height: blockHeader.height,
				stateRoot: blockHeader.stateRoot as Buffer,
				timestamp: blockHeader.timestamp,
				validatorsHash: blockHeader.validatorsHash as Buffer,
			};

			const encodedCertificate = codec.encode(certificateSchema, certificate);

			signatures = privateKeys.map(privateKey =>
				signBLS(MESSAGE_TAG_CERTIFICATE, networkIdentifier, encodedCertificate, privateKey),
			);

			pubKeySignaturePairs = Array.from({ length: 103 }, (_, i) => ({
				publicKey: publicKeys[i],
				signature: signatures[i],
			}));

			({ aggregationBits, signature: aggregateSignature } = createAggSig(
				publicKeys,
				pubKeySignaturePairs,
			));

			aggregateCommit = {
				aggregationBits,
				certificateSignature: aggregateSignature,
				height,
			};

			validators = weights.map((weight, i) => ({
				address: getRandomBytes(20),
				bftWeight: BigInt(weight),
				blsKey: keysList[i],
			}));

			when(chain.dataAccess.getBlockHeaderByHeight).calledWith(height).mockReturnValue(blockHeader);

			bftAPI.getBFTHeights.mockReturnValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			when(bftAPI.getBFTParameters).calledWith(apiContext, height).mockReturnValue({
				certificateThreshold: threshold,
				validators,
			});

			when(bftAPI.getNextHeightBFTParameters)
				.calledWith(apiContext, maxHeightCertified + 1)
				.mockImplementation(() => {
					throw new BFTParameterNotFoundError();
				});
		});

		it('should return true with proper parameters', async () => {
			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeTrue();
		});

		it('should return false when aggregate commit is not signed at height maxHeightCertified', async () => {
			maxHeightCertified = 1080;
			maxHeightPrecommitted = 1100;

			bftAPI.getBFTHeights.mockReturnValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeFalse();
		});

		it('should return false when certificateSignature empty', async () => {
			aggregateCommit = {
				aggregationBits,
				certificateSignature: Buffer.alloc(0),
				height,
			};

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeFalse();
		});

		it('should return false when aggregationBits empty', async () => {
			aggregateCommit = {
				aggregationBits: Buffer.alloc(0),
				certificateSignature: aggregateSignature,
				height,
			};

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeFalse();
		});

		it('should return false when aggregateCommit height is lesser than equal to maxHeightCertified', async () => {
			aggregateCommit = {
				aggregationBits,
				certificateSignature: aggregateSignature,
				height: 5000,
			};

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeFalse();
		});

		it('should return false when aggregateCommit height is more than maxHeightPrecommitted', async () => {
			aggregateCommit = {
				aggregationBits,
				certificateSignature: aggregateSignature,
				height: 15000,
			};

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeFalse();
		});

		it('should return false when aggregateCommit height is above nextBFTParameter height minus 1', async () => {
			when(bftAPI.getNextHeightBFTParameters)
				.calledWith(apiContext, maxHeightCertified + 1)
				.mockReturnValue(1020);

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeFalse();
		});

		it('should return true when aggregateCommit height is equal nextBFTParameter height minus 1', async () => {
			when(bftAPI.getNextHeightBFTParameters)
				.calledWith(apiContext, maxHeightCertified + 1)
				.mockReturnValue(height + 1);

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeTrue();
		});

		it('should return true when aggregateCommit height is below nextBFTParameter height minus 1', async () => {
			when(bftAPI.getNextHeightBFTParameters)
				.calledWith(apiContext, maxHeightCertified + 1)
				.mockReturnValue(height + 10);

			const isCommitVerified = await commitPool.verifyAggregateCommit(apiContext, aggregateCommit);

			expect(isCommitVerified).toBeTrue();
		});
	});
	describe('getAggregateCommit', () => {
		it.todo('');
	});
	describe('_getMaxRemovalHeight', () => {
		let blockHeader: BlockHeader;
		const finalizedHeight = 1010;

		beforeEach(() => {
			chain.finalizedHeight = finalizedHeight;

			blockHeader = createFakeBlockHeader({
				height: finalizedHeight,
				timestamp: finalizedHeight * 10,
				aggregateCommit: {
					aggregationBits: Buffer.alloc(0),
					certificateSignature: Buffer.alloc(0),
					height: finalizedHeight,
				},
			});

			when(getBlockHeaderByHeight).mockImplementation(async () =>
				Promise.reject(new NotFoundError('')),
			);
			when(getBlockHeaderByHeight).calledWith(finalizedHeight).mockReturnValue(blockHeader);
		});
		it('should return successfully for an existing block header at finalizedHeight', async () => {
			const maxRemovalHeight = await commitPool['_getMaxRemovalHeight']();

			expect(maxRemovalHeight).toBe(blockHeader.aggregateCommit.height);
		});
		it('should throw an error for non-existent block header at finalizedHeight', async () => {
			chain.finalizedHeight = finalizedHeight + 1;

			await expect(commitPool['_getMaxRemovalHeight']()).rejects.toThrow(NotFoundError);
		});
	});
	describe('_aggregateSingleCommits', () => {
		it.todo('');
	});

	describe('aggregateSingleCommits', () => {
		const height = 45678;
		const blockHeader1 = createFakeBlockHeader({ height });
		const blockHeader2 = createFakeBlockHeader({ height });
		const blockHeader3 = createFakeBlockHeader({ height });
		const validatorInfo1 = {
			address: getRandomBytes(20),
			blsPublicKey: getRandomBytes(48),
			blsSecretKey: getRandomBytes(32),
		};
		const validatorInfo2 = {
			address: getRandomBytes(20),
			blsPublicKey: getRandomBytes(48),
			blsSecretKey: getRandomBytes(32),
		};
		const validatorInfo3 = {
			address: getRandomBytes(20),
			blsPublicKey: getRandomBytes(48),
			blsSecretKey: getRandomBytes(32),
		};
		const certificate1 = computeCertificateFromBlockHeader(blockHeader1);
		const certificate2 = computeCertificateFromBlockHeader(blockHeader2);
		const certificate3 = computeCertificateFromBlockHeader(blockHeader3);
		const singleCommit1 = {
			blockID: blockHeader1.id,
			height: blockHeader1.height,
			validatorAddress: validatorInfo1.address,
			certificateSignature: signCertificate(
				validatorInfo1.blsSecretKey,
				networkIdentifier,
				certificate1,
			),
		};
		const singleCommit2 = {
			blockID: blockHeader2.id,
			height: blockHeader2.height,
			validatorAddress: validatorInfo2.address,
			certificateSignature: signCertificate(
				validatorInfo2.blsSecretKey,
				networkIdentifier,
				certificate2,
			),
		};
		const singleCommit3 = {
			blockID: blockHeader3.id,
			height: blockHeader3.height,
			validatorAddress: validatorInfo3.address,
			certificateSignature: signCertificate(
				validatorInfo3.blsSecretKey,
				networkIdentifier,
				certificate3,
			),
		};
		const singleCommits = [singleCommit1, singleCommit2, singleCommit3];
		const validatorKeys = [
			validatorInfo1.blsPublicKey,
			validatorInfo2.blsPublicKey,
			validatorInfo3.blsPublicKey,
		];
		validatorKeys.sort((blsKeyA, blsKeyB) => blsKeyA.compare(blsKeyB));
		const pubKeySignaturePair1 = {
			publicKey: validatorInfo1.blsPublicKey,
			signature: singleCommit1.certificateSignature,
		};
		const pubKeySignaturePair2 = {
			publicKey: validatorInfo2.blsPublicKey,
			signature: singleCommit2.certificateSignature,
		};
		const pubKeySignaturePair3 = {
			publicKey: validatorInfo3.blsPublicKey,
			signature: singleCommit3.certificateSignature,
		};
		const pubKeySignaturePairs = [pubKeySignaturePair1, pubKeySignaturePair2, pubKeySignaturePair3];

		const { aggregationBits: aggregationBits1, signature: aggregateSignature1 } = createAggSig(
			[validatorInfo1.blsPublicKey],
			[pubKeySignaturePair1],
		);

		const { aggregationBits, signature: aggregateSignature } = createAggSig(
			validatorKeys,
			pubKeySignaturePairs,
		);

		let expectedCommit: AggregateCommit;
		let context: APIContext;

		beforeEach(() => {
			commitPool = new CommitPool({
				bftAPI,
				blockTime,
				network,
				chain,
				db: jest.fn() as any,
			});
			context = createTransientAPIContext({});
		});

		it('should throw if there are no single commits', async () => {
			await expect(commitPool.aggregateSingleCommits(context, [])).rejects.toThrow(
				'No single commit found',
			);
		});

		it('should return aggregated commit if there is atleast 1 single commit', async () => {
			expectedCommit = {
				height,
				aggregationBits: aggregationBits1,
				certificateSignature: aggregateSignature1,
			};
			bftAPI.getBFTParameters.mockReturnValue({
				validators: [{ address: validatorInfo1.address, blsKey: validatorInfo1.blsPublicKey }],
			});

			await expect(
				commitPool.aggregateSingleCommits(context, [singleCommit1]),
			).resolves.toStrictEqual(expectedCommit);
		});

		it('should return aggregated commit for multiple single commits', async () => {
			expectedCommit = { height, aggregationBits, certificateSignature: aggregateSignature };
			bftAPI.getBFTParameters.mockReturnValue({
				validators: [
					{ address: validatorInfo1.address, blsKey: validatorInfo1.blsPublicKey },
					{ address: validatorInfo2.address, blsKey: validatorInfo2.blsPublicKey },
					{ address: validatorInfo3.address, blsKey: validatorInfo3.blsPublicKey },
				],
			});

			await expect(
				commitPool.aggregateSingleCommits(context, singleCommits),
			).resolves.toStrictEqual(expectedCommit);
		});

		it('should throw if no bls public key is found for the validator', async () => {
			expectedCommit = { height, aggregationBits, certificateSignature: aggregateSignature };
			bftAPI.getBFTParameters.mockReturnValue({
				validators: [
					{ address: validatorInfo1.address, blsKey: validatorInfo1.blsPublicKey },
					{ address: validatorInfo2.address, blsKey: validatorInfo2.blsPublicKey },
				],
			});

			await expect(commitPool.aggregateSingleCommits(context, singleCommits)).rejects.toThrow(
				`No bls public key entry found for validatorAddress ${validatorInfo3.address.toString(
					'hex',
				)}`,
			);
		});

		it('should call validator keys in lexicographical order', async () => {
			const spy = jest.spyOn(crypto, 'createAggSig');
			bftAPI.getBFTParameters.mockReturnValue({
				validators: [
					{ address: validatorInfo1.address, blsKey: validatorInfo1.blsPublicKey },
					{ address: validatorInfo2.address, blsKey: validatorInfo2.blsPublicKey },
					{ address: validatorInfo3.address, blsKey: validatorInfo3.blsPublicKey },
				],
			});

			await commitPool.aggregateSingleCommits(context, singleCommits);

			expect(spy).toHaveBeenCalledWith(validatorKeys, pubKeySignaturePairs);
		});
	});

	describe('_selectAggregateCommit', () => {
		const maxHeightPrecommitted = 1053;
		const maxHeightCertified = 1050;
		const heightNextBFTParameters = 1053;
		const threshold = 1;
		const blockHeader1 = createFakeBlockHeader({ height: 1051 });
		const blockHeader2 = createFakeBlockHeader({ height: 1052 });
		const validatorInfo1 = {
			address: getRandomBytes(20),
			blsPublicKey: getRandomBytes(48),
			blsSecretKey: getRandomBytes(32),
		};
		const validatorInfo2 = {
			address: getRandomBytes(20),
			blsPublicKey: getRandomBytes(48),
			blsSecretKey: getRandomBytes(32),
		};
		const certificate1 = computeCertificateFromBlockHeader(blockHeader1);
		const certificate2 = computeCertificateFromBlockHeader(blockHeader2);
		const singleCommit1 = {
			blockID: blockHeader1.id,
			height: blockHeader1.height,
			validatorAddress: validatorInfo1.address,
			certificateSignature: signCertificate(
				validatorInfo1.blsSecretKey,
				networkIdentifier,
				certificate1,
			),
		};
		const singleCommit2 = {
			blockID: blockHeader2.id,
			height: blockHeader2.height,
			validatorAddress: validatorInfo2.address,
			certificateSignature: signCertificate(
				validatorInfo2.blsSecretKey,
				networkIdentifier,
				certificate2,
			),
		};
		let apiContext: APIContext;

		beforeEach(() => {
			commitPool = new CommitPool({
				bftAPI,
				blockTime,
				network,
				chain,
				db: jest.fn() as any,
			});
			commitPool['_nonGossipedCommits'].add(singleCommit1);
			commitPool['_gossipedCommits'].add(singleCommit2);
			commitPool['aggregateSingleCommits'] = jest.fn();
			apiContext = createTransientAPIContext({});

			bftAPI.getBFTHeights.mockResolvedValue({
				maxHeightCertified,
				maxHeightPrecommitted,
			});

			bftAPI.getNextHeightBFTParameters.mockResolvedValue(heightNextBFTParameters);

			bftAPI.getBFTParameters.mockResolvedValue({
				certificateThreshold: threshold,
				validators: [
					{ address: validatorInfo1.address, bftWeight: BigInt(1) },
					{ address: validatorInfo2.address, bftWeight: BigInt(1) },
				],
			});
		});

		it('should call bft api getBFTHeights', async () => {
			// Act
			await commitPool['_selectAggregateCommit'](apiContext);

			// Assert
			expect(commitPool['_bftAPI'].getBFTHeights).toHaveBeenCalledWith(apiContext);
		});

		it('should call bft api getNextHeightBFTParameters', async () => {
			// Act
			await commitPool['_selectAggregateCommit'](apiContext);

			// Assert
			expect(commitPool['_bftAPI'].getNextHeightBFTParameters).toHaveBeenCalledWith(
				apiContext,
				maxHeightCertified + 1,
			);
		});

		it('should call bft api getBFTParameters with min(heightNextBFTParameters - 1, maxHeightPrecommitted)', async () => {
			// Act
			await commitPool['_selectAggregateCommit'](apiContext);

			// Assert
			expect(commitPool['_bftAPI'].getBFTParameters).toHaveBeenCalledWith(
				apiContext,
				Math.min(heightNextBFTParameters - 1, maxHeightPrecommitted),
			);
		});

		it('should call getBFTParameters with maxHeightPrecommitted if getNextHeightBFTParameters does not return a valid height', async () => {
			// Arrange
			bftAPI.getNextHeightBFTParameters.mockRejectedValue(new BFTParameterNotFoundError('Error'));

			// Act
			await commitPool['_selectAggregateCommit'](apiContext);

			// Assert
			expect(commitPool['_bftAPI'].getBFTParameters).toHaveBeenCalledWith(
				apiContext,
				maxHeightPrecommitted,
			);
		});

		it('should call aggregateSingleCommits when it reaches threshold', async () => {
			// Act
			await commitPool['_selectAggregateCommit'](apiContext);

			// Assert
			expect(commitPool['aggregateSingleCommits']).toHaveBeenCalledWith(apiContext, [
				singleCommit2,
			]);
		});

		it('should not call aggregateSingleCommits when it does not reach threshold and return default aggregateCommit', async () => {
			// Arrange
			bftAPI.getBFTParameters.mockReturnValue({
				certificateThreshold: 10,
				validators: [
					{ address: validatorInfo1.address, bftWeight: BigInt(1) },
					{ address: validatorInfo2.address, bftWeight: BigInt(1) },
				],
			});

			// Act
			const result = await commitPool['_selectAggregateCommit'](apiContext);

			// Assert
			expect(commitPool['aggregateSingleCommits']).not.toHaveBeenCalled();
			expect(result).toEqual({
				height: maxHeightCertified,
				aggregationBits: Buffer.alloc(0),
				certificateSignature: Buffer.alloc(0),
			});
		});
	});
});
