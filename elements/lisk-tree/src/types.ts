/*
 * Copyright © 2020 Lisk Foundation
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

export const enum NodeType {
	BRANCH = 'branch',
	LEAF = 'leaf',
}
export interface NodeData {
	readonly value: Buffer;
	readonly hash: Buffer;
}
export interface NodeInfo {
	readonly type: NodeType;
	readonly hash: Buffer;
	readonly value: Buffer;
	readonly leftHash: Buffer;
	readonly rightHash: Buffer;
	readonly layerIndex: number;
	readonly nodeIndex: number;
}
export const enum NodeSide {
	LEFT = 0,
	RIGHT,
}
export interface TreeStructure {
	[key: number]: NodeInfo[];
}
export type Path = Array<{ hash: Buffer; direction: number } | undefined>;
