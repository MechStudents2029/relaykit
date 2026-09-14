declare module "autocannon" {
  export interface AutocannonClient {
    setBody(body: string): void;
  }

  export interface AutocannonResult {
    "1xx": number;
    "2xx": number;
    "3xx": number;
    "4xx": number;
    "5xx": number;
    latency: { mean: number };
    requests: { average: number; total: number };
  }

  export interface AutocannonOptions {
    url: string;
    method?: string;
    connections?: number;
    duration?: number;
    pipelining?: number;
    headers?: Record<string, string>;
    setupClient?: (client: AutocannonClient) => void;
  }

  interface Autocannon {
    (options: AutocannonOptions): Promise<AutocannonResult>;
    printResult(result: AutocannonResult): string;
  }

  const autocannon: Autocannon;
  export default autocannon;
}
