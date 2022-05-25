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

import { Transaction, StateStore } from '@liskhq/lisk-chain';
import { Logger } from '../../logger';
import { createAPIContext, createImmutableAPIContext, wrapEventQueue } from './api_context';
import { EVENT_INDEX_AFTER_TRANSACTIONS, EVENT_INDEX_BEFORE_TRANSACTIONS } from './constants';
import { EventQueue } from './event_queue';
import { TransactionContext } from './transaction_context';
import {
	BlockAfterExecuteContext,
	BlockExecuteContext,
	BlockVerifyContext,
	BlockHeader,
	BlockAssets,
	Validator,
} from './types';

export interface ContextParams {
	networkIdentifier: Buffer;
	stateStore: StateStore;
	header: BlockHeader;
	assets: BlockAssets;
	logger: Logger;
	currentValidators: Validator[];
	impliesMaxPrevote: boolean;
	maxHeightCertified: number;
	eventQueue: EventQueue;
	transactions?: ReadonlyArray<Transaction>;
}

export class BlockContext {
	private readonly _stateStore: StateStore;
	private readonly _networkIdentifier: Buffer;
	private readonly _logger: Logger;
	private readonly _eventQueue: EventQueue;
	private readonly _header: BlockHeader;
	private readonly _assets: BlockAssets;
	private readonly _currentValidators: Validator[];
	private readonly _impliesMaxPrevote: boolean;
	private readonly _maxHeightCertified: number;
	private _transactions?: ReadonlyArray<Transaction>;
	private _nextValidators?: {
		precommitThreshold: bigint;
		certificateThreshold: bigint;
		validators: Validator[];
	};

	public constructor(params: ContextParams) {
		this._logger = params.logger;
		this._networkIdentifier = params.networkIdentifier;
		this._stateStore = params.stateStore;
		this._eventQueue = params.eventQueue;
		this._header = params.header;
		this._assets = params.assets;
		this._currentValidators = params.currentValidators;
		this._impliesMaxPrevote = params.impliesMaxPrevote;
		this._maxHeightCertified = params.maxHeightCertified;
		this._transactions = params.transactions;
	}

	public get transactions(): ReadonlyArray<Transaction> {
		if (!this._transactions) {
			throw new Error('Transactions are not set');
		}
		return this._transactions;
	}

	public setTransactions(transactions: Transaction[]): void {
		this._transactions = transactions;
	}

	public getBlockVerifyExecuteContext(): BlockVerifyContext {
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			getAPIContext: () => createImmutableAPIContext(this._stateStore),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
			assets: this._assets,
		};
	}

	public getBlockExecuteContext(): BlockExecuteContext {
		const wrappedEventQueue = wrapEventQueue(this._eventQueue, EVENT_INDEX_BEFORE_TRANSACTIONS);
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			eventQueue: wrappedEventQueue,
			getAPIContext: () =>
				createAPIContext({ stateStore: this._stateStore, eventQueue: wrappedEventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
			assets: this._assets,
			currentValidators: this._currentValidators,
			impliesMaxPrevote: this._impliesMaxPrevote,
			maxHeightCertified: this._maxHeightCertified,
		};
	}

	public getBlockAfterExecuteContext(): BlockAfterExecuteContext {
		if (!this._transactions) {
			throw new Error('Cannot create block after execute context without transactions');
		}
		const wrappedEventQueue = wrapEventQueue(this._eventQueue, EVENT_INDEX_AFTER_TRANSACTIONS);
		return {
			logger: this._logger,
			networkIdentifier: this._networkIdentifier,
			eventQueue: wrappedEventQueue,
			getAPIContext: () =>
				createAPIContext({ stateStore: this._stateStore, eventQueue: wrappedEventQueue }),
			getStore: (moduleID: number, storePrefix: number) =>
				this._stateStore.getStore(moduleID, storePrefix),
			header: this._header,
			assets: this._assets,
			transactions: this._transactions,
			currentValidators: this._currentValidators,
			impliesMaxPrevote: this._impliesMaxPrevote,
			maxHeightCertified: this._maxHeightCertified,
			setNextValidators: (
				precommitThreshold: bigint,
				certificateThreshold: bigint,
				validators: Validator[],
			) => {
				if (this._nextValidators) {
					throw new Error('Next validators can be set only once');
				}
				this._nextValidators = {
					precommitThreshold,
					certificateThreshold,
					validators: [...validators],
				};
			},
		};
	}

	public getTransactionContext(tx: Transaction): TransactionContext {
		return new TransactionContext({
			networkIdentifier: this._networkIdentifier,
			logger: this._logger,
			stateStore: this._stateStore,
			transaction: tx,
			eventQueue: this._eventQueue,
			header: this._header,
			assets: this._assets,
		});
	}

	public get eventQueue(): EventQueue {
		return this._eventQueue;
	}

	public get nextValidators() {
		return (
			this._nextValidators ?? {
				certificateThreshold: BigInt(0),
				precommitThreshold: BigInt(0),
				validators: [],
			}
		);
	}
}
