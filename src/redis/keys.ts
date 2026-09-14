export interface StreamKeys {
  stream: string;
  group: string;
  delayed: string;
  dlq: string;
  job: (id: string) => string;
  idemp: (key: string) => string;
  delivery: (id: string) => string;
}

export function streamKeys(prefix = "relaykit"): StreamKeys {
  return {
    stream: `${prefix}:jobs`,
    group: `${prefix}-workers`,
    delayed: `${prefix}:delayed`,
    dlq: `${prefix}:dlq`,
    job: (id) => `${prefix}:job:${id}`,
    idemp: (key) => `${prefix}:idemp:${key}`,
    delivery: (id) => `${prefix}:delivery:${id}`,
  };
}
