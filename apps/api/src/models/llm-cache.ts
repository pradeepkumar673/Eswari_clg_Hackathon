import mongoose, { Schema, Document } from 'mongoose';

export interface ILlmCache {
  input_hash: string;
  model: string;
  prompt_type: string;
  input_text: string;
  output_text: string;
  tokens_used: number;
  created_at: Date;
}

const LlmCacheSchema = new Schema<ILlmCache>(
  {
    input_hash: {
      type: String,
      required: true,
      unique: true,
    },
    model: {
      type: String,
      required: true,
    },
    prompt_type: {
      type: String,
      required: true,
      enum: ['NARRATION', 'EXTRACTION', 'PLAYBOOK'],
    },
    input_text: {
      type: String,
      required: true,
    },
    output_text: {
      type: String,
      required: true,
    },
    tokens_used: {
      type: Number,
      required: true,
    },
    created_at: {
      type: Date,
      required: true,
    },
  },
  { collection: 'llm_cache' }
);

export const LlmCache = mongoose.model<ILlmCache>('LlmCache', LlmCacheSchema);
export const LLMCache = LlmCache;
