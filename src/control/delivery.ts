import { createHash, createHmac } from 'node:crypto';
import type { Config } from '../config.js';
import { version } from '../metadata.js';
import type { DeploymentPayload } from './store.js';

export interface WebhookAction {
  format: 'gozne-action-v1';
  actionId: string;
  application: string;
  requester: string;
  payload: DeploymentPayload;
  payloadHash: string;
  approvals: string[];
  requestedAt: number;
  expiresAt: number;
}

export interface DeliveryResult {
  statusCode: number;
  responseDigest: string;
}

async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 64 * 1024) {
      await reader.cancel();
      throw new Error('ACTION_RESPONSE_TOO_LARGE');
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks, length);
}

export async function deliverWebhook(
  config: Extract<Config['actionDelivery'], { mode: 'webhook' }>,
  action: WebhookAction,
  now: number,
): Promise<DeliveryResult> {
  const body = JSON.stringify(action);
  const timestamp = String(now);
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': `gozne/${version}`,
      'idempotency-key': action.actionId,
      'x-gozne-timestamp': timestamp,
      'x-gozne-signature': `sha256=${signature}`,
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const responseBody = await boundedResponse(response);
  if (!response.ok) throw new Error(`ACTION_HTTP_${response.status}`);
  return {
    statusCode: response.status,
    responseDigest: createHash('sha256').update(responseBody).digest('hex'),
  };
}
