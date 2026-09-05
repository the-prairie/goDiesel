/** Explicit provider selection. Never try another service after a failure. */
import { WalkStop } from '../core.mjs';
import { openaiDecision } from './openai.mjs';
import { vertexConfiguration, vertexDecision } from './vertex.mjs';

export const liveAdapterIds = Object.freeze(['openai-responses', 'vertex-gemini']);
export function configuredAgent(environ = process.env) {
  const selected = environ.GODIESEL_WALK_PROVIDER ?? 'openai';
  // Snapshot only the selected provider's configuration for this invocation.
  const shared = { GODIESEL_WALK_MODEL: environ.GODIESEL_WALK_MODEL, GODIESEL_WALK_ALLOW_REMOTE_AGENT: environ.GODIESEL_WALK_ALLOW_REMOTE_AGENT };
  if (selected === 'vertex') {
    const env = { ...shared, GOOGLE_API_KEY: environ.GOOGLE_API_KEY };
    const { model } = vertexConfiguration(env);
    return { id: 'vertex-gemini', model, decide: (input, schema) => vertexDecision(input, schema, { environ: env }) };
  }
  if (selected !== 'openai') throw new WalkStop('AGENT_UNCONFIGURED', 'Choose GODIESEL_WALK_PROVIDER=openai or vertex.');
  if (shared.GODIESEL_WALK_ALLOW_REMOTE_AGENT !== '1' || !environ.OPENAI_API_KEY || !/^[a-zA-Z0-9._:-]{1,100}$/.test(shared.GODIESEL_WALK_MODEL ?? ''))
    throw new WalkStop('AGENT_UNCONFIGURED', 'OpenAI exploration needs OPENAI_API_KEY, an explicit model, and permission to send screenshots.');
  const env = { ...shared, OPENAI_API_KEY: environ.OPENAI_API_KEY };
  return { id: 'openai-responses', model: shared.GODIESEL_WALK_MODEL, decide: (input, schema) => openaiDecision(input, schema, { environ: env }) };
}
