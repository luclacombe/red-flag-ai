-- Pipeline metrics for agent observability
CREATE TABLE pipeline_metrics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id uuid REFERENCES analyses(id) ON DELETE CASCADE,
  step text NOT NULL,
  duration_ms integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  model text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX pipeline_metrics_analysis_id_idx ON pipeline_metrics(analysis_id);
CREATE INDEX pipeline_metrics_created_at_idx ON pipeline_metrics(created_at);

-- Enable RLS (no policies = server-only access via service role)
ALTER TABLE pipeline_metrics ENABLE ROW LEVEL SECURITY;
