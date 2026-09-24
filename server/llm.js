// One Anthropic client for every model-backed feature on the server, so the
// key check, the model choice and the refusal-fallback handling live in one
// place rather than once per feature.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';

class AgentUnavailableError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AgentUnavailableError('no-key', 'ANTHROPIC_API_KEY is not set');
  }
  if (!client) client = new Anthropic({ maxRetries: 0 });
  return client;
}

// Sends a Messages request opted into Anthropic's server-side refusal
// fallbacks: a declined request is re-run on the recommended fallback model
// inside the same call rather than coming back as a refusal. If the account or
// request shape rejects the beta, the plain endpoint is tried once, because a
// working answer beats a feature flag.
async function createWithFallbacks(request, options) {
  const anthropic = getClient();
  try {
    return await anthropic.beta.messages.create(
      { ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
      options
    );
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(String(err.message))) {
      console.warn('LLM: fallbacks rejected, retrying without them —', err.message);
      return anthropic.messages.create(request, options);
    }
    throw err;
  }
}

// Pulls the text out of a structured-output reply, after checking it is one.
function parseStructuredReply(response, what) {
  if (response.stop_reason === 'refusal') throw new Error(`the model declined the ${what} request`);
  if (response.stop_reason === 'max_tokens') throw new Error(`the ${what} reply was cut off at max_tokens`);
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

function logUsage(label, response) {
  const u = response.usage || {};
  console.log(`${label}: ${u.input_tokens || 0} in / ${u.output_tokens || 0} out, ` +
    `${u.cache_read_input_tokens || 0} cached, served by ${response.model}`);
}

module.exports = { MODEL, getClient, createWithFallbacks, parseStructuredReply, logUsage, AgentUnavailableError };
