import { buildIssueModal } from '../views/issue-modal-builder.js';
import { sessionStore } from '../../thread-context/index.js';

/**
 * Handle category button clicks from the App Home.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs<import('@slack/bolt').BlockButtonAction>} args
 * @returns {Promise<void>}
 */
export async function handleIssueButton({ ack, body, client, context, logger }) {
  await ack();

  try {
    const category = /** @type {string} */ (body.actions[0].value);
    const triggerId = body.trigger_id;
    const userId = /** @type {string} */ (context.userId);

    // Record that this user is reporting an issue in this category
    sessionStore.recordIssue(userId, category);

    const modal = buildIssueModal(category);
    await client.views.open({ trigger_id: triggerId, view: modal });
  } catch (e) {
    logger.error(`Failed to open issue modal: ${e}`);
  }
}
