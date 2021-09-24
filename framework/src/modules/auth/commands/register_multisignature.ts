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

import { BaseCommand } from '../..';
import {
	CommandExecuteContext,
	CommandVerifyContext,
	VerificationResult,
	VerifyStatus,
} from '../../../node/state_machine';
import { COMMAND_ID_DELEGATE_REGISTRATION } from '../constants';
import { registerMultisignatureParamsSchema } from '../schemas';

export class RegisterMultisignatureCommand extends BaseCommand {
	public id = COMMAND_ID_DELEGATE_REGISTRATION;
	public name = 'registerMultisignatureGroup';
	public schema = registerMultisignatureParamsSchema;

	// eslint-disable-next-line @typescript-eslint/require-await
	public async verify(
		_context: CommandVerifyContext<Record<string, unknown>>,
	): Promise<VerificationResult> {
		return {
			status: VerifyStatus.OK,
		};
	}

	// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-empty-function
	public async execute(_context: CommandExecuteContext<Record<string, unknown>>): Promise<void> {}
}
