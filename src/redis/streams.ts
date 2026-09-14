import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import type { Clock } from "../core/clock.js";
import { systemClock } from "../core/clock.js";
import { normalizeIdempotencyKey } from "../core/idempotency.js";
import { transition } from "../core/status-machine.js";
import { DEFAULT_MAX_ATTEMPTS, type EnqueueInput, type EnqueueResult, type JobEnvelope } from "../types/job.js";
import type { Transport } from "../transport/types.js";
import { streamKeys, type StreamKeys } from "./keys.js";

export interface RedisStreamsTransportOptions {
  url?: string;
  prefix?: string;
  consumer?: string;
  blockMs?: number;
  clock?: Clock;
  defaultMaxAttempts?: number;
  client?: RedisClientType;
}

type ConnectedClient = RedisClientType;

export class RedisStreamsTransport implements Transport {
  private readonly url: string;
  private readonly keys: StreamKeys;
  private readonly consumer: string;
  private readonly blockMs: number;
  private readonly clock: Clock;
  private readonly defaultMaxAttempts: number;
  private readonly ownedClient: boolean;
  private client: ConnectedClient;
  private ready: Promise<void> | undefined;

  constructor(options: RedisStreamsTransportOptions = {}) {
    this.url = options.url ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    this.keys = streamKeys(options.prefix ?? "relaykit");
    this.consumer = options.consumer ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.blockMs = options.blockMs ?? 2_000;
    this.clock = options.clock ?? systemClock;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.ownedClient = !options.client;
    this.client =
      options.client ??
      createClient({
        url: this.url,
        socket: { connectTimeout: 1_000, reconnectStrategy: false },
      });
  }

  async enqueue<T>(input: EnqueueInput<T>): Promise<EnqueueResult<T>> {
    const redis = await this.connect();
    const key = normalizeIdempotencyKey(input.idempotencyKey);
    const id = input.id ?? randomUUID();
    const reserved = await redis.set(this.keys.idemp(key), id, { NX: true });
    if (reserved === null) {
      const existingId = await redis.get(this.keys.idemp(key));
      if (!existingId) {
        throw new Error(`idempotency key ${key} vanished during enqueue`);
      }
      const existing = await this.getById(existingId);
      if (!existing) {
        throw new Error(`idempotency key ${key} points at missing job ${existingId}`);
      }
      return { job: existing as JobEnvelope<T>, duplicate: true };
    }

    const now = this.clock.now();
    const pending: JobEnvelope<T> = {
      id,
      type: input.type,
      payload: input.payload,
      idempotencyKey: key,
      status: "pending",
      attempt: 0,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
      createdAt: now,
      updatedAt: now,
      availableAt: now,
    };
    const queued = transition(pending, "queued", now);
    await this.save(queued);
    await redis.xAdd(this.keys.stream, "*", { id: queued.id });
    return { job: queued, duplicate: false };
  }

  async claim(blockMs?: number): Promise<JobEnvelope | undefined> {
    const redis = await this.connect();
    await this.promoteDelayed();
    const block = blockMs ?? this.blockMs;
    // Redis BLOCK 0 waits forever; treat 0 as a non-blocking poll.
    const result = await redis.xReadGroup(
      this.keys.group,
      this.consumer,
      { key: this.keys.stream, id: ">" },
      block > 0 ? { COUNT: 1, BLOCK: block } : { COUNT: 1 },
    );
    const message = result?.[0]?.messages[0];
    if (!message) {
      return undefined;
    }
    const jobId = streamField(message.message, "id");
    if (!jobId) {
      await redis.xAck(this.keys.stream, this.keys.group, String(message.id));
      return undefined;
    }
    const job = await this.getById(jobId);
    if (!job) {
      await redis.xAck(this.keys.stream, this.keys.group, message.id);
      return undefined;
    }
    const processing = transition(job, "processing", this.clock.now(), { attempt: job.attempt + 1 });
    await this.save(processing);
    await redis.set(this.keys.delivery(processing.id), String(message.id));
    return processing;
  }

  async complete(job: JobEnvelope, result?: unknown): Promise<JobEnvelope> {
    const current = await this.require(job.id);
    const next = transition(current, "succeeded", this.clock.now(), { result, lastError: undefined });
    await this.save(next);
    await this.ack(next);
    return next;
  }

  async retry(job: JobEnvelope, delayMs: number, error: string): Promise<JobEnvelope> {
    const redis = await this.connect();
    const current = await this.require(job.id);
    const now = this.clock.now();
    const retrying = transition(current, "retrying", now, {
      lastError: error,
      availableAt: now + Math.max(0, delayMs),
    });
    const queued = transition(retrying, "queued", now, {
      lastError: error,
      availableAt: retrying.availableAt,
    });
    await this.save(queued);
    await this.ack(queued);
    await redis.zAdd(this.keys.delayed, { score: queued.availableAt, value: queued.id });
    return queued;
  }

  async fail(job: JobEnvelope, error: string): Promise<JobEnvelope> {
    const current = await this.require(job.id);
    const next = transition(current, "failed", this.clock.now(), { lastError: error });
    await this.save(next);
    await this.ack(next);
    return next;
  }

  async deadLetter(job: JobEnvelope, error: string): Promise<JobEnvelope> {
    const redis = await this.connect();
    const current = await this.require(job.id);
    const next = transition(current, "dead_lettered", this.clock.now(), { lastError: error });
    await this.save(next);
    await this.ack(next);
    await redis.xAdd(this.keys.dlq, "*", { id: next.id, error });
    return next;
  }

  async getById(id: string): Promise<JobEnvelope | undefined> {
    const redis = await this.connect();
    const raw = await redis.get(this.keys.job(id));
    return raw ? (JSON.parse(raw) as JobEnvelope) : undefined;
  }

  async getByIdempotencyKey(key: string): Promise<JobEnvelope | undefined> {
    const redis = await this.connect();
    const id = await redis.get(this.keys.idemp(normalizeIdempotencyKey(key)));
    return id ? this.getById(id) : undefined;
  }

  async listDeadLetters(): Promise<JobEnvelope[]> {
    const redis = await this.connect();
    const entries = await redis.xRange(this.keys.dlq, "-", "+", { COUNT: 100 });
    const jobs: JobEnvelope[] = [];
    for (const entry of entries) {
      const id = streamField(entry.message, "id");
      if (!id) {
        continue;
      }
      const job = await this.getById(id);
      if (job) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  async pendingLag(): Promise<number> {
    const redis = await this.connect();
    const delayed = Number(await redis.zCard(this.keys.delayed));
    try {
      const groups = await redis.xInfoGroups(this.keys.stream);
      const group = groups.find((entry) => String(entry.name) === this.keys.group);
      return Number(group?.lag ?? 0) + delayed;
    } catch {
      const pending = await redis.xPending(this.keys.stream, this.keys.group);
      return Number(pending.pending) + delayed;
    }
  }

  async close(): Promise<void> {
    if (!this.ownedClient) {
      return;
    }
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async connect(): Promise<ConnectedClient> {
    if (!this.ready) {
      this.ready = this.bootstrap();
    }
    await this.ready;
    return this.client;
  }

  private async bootstrap(): Promise<void> {
    this.client.on("error", () => {
      /* connection errors surface on command; avoid unhandled 'error' */
    });
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    try {
      await this.client.xGroupCreate(this.keys.stream, this.keys.group, "0", { MKSTREAM: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  private async save(job: JobEnvelope): Promise<void> {
    const redis = await this.connect();
    await redis.set(this.keys.job(job.id), JSON.stringify(job));
  }

  private async ack(job: JobEnvelope): Promise<void> {
    const redis = await this.connect();
    const streamId = await redis.get(this.keys.delivery(job.id));
    if (streamId) {
      await redis.xAck(this.keys.stream, this.keys.group, streamId);
      await redis.del(this.keys.delivery(job.id));
    }
  }

  private async require(id: string): Promise<JobEnvelope> {
    const job = await this.getById(id);
    if (!job) {
      throw new Error(`unknown job ${id}`);
    }
    return job;
  }

  private async promoteDelayed(): Promise<void> {
    const redis = await this.connect();
    const now = this.clock.now();
    const due = await redis.zRangeByScore(this.keys.delayed, 0, now);
    for (const id of due) {
      const removed = await redis.zRem(this.keys.delayed, id);
      if (removed === 0) {
        continue;
      }
      await redis.xAdd(this.keys.stream, "*", { id });
    }
  }
}

function streamField(message: unknown, name: string): string | undefined {
  if (!message) {
    return undefined;
  }
  if (message instanceof Map) {
    const value = message.get(name) ?? message.get(Buffer.from(name));
    return value == null ? undefined : String(value);
  }
  if (typeof message === "object") {
    const record = message as Record<string, unknown>;
    const value = record[name];
    return value == null ? undefined : String(value);
  }
  return undefined;
}

export async function redisAvailable(url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"): Promise<boolean> {
  const client = createClient({
    url,
    socket: { connectTimeout: 300, reconnectStrategy: false },
  });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    try {
      client.destroy();
    } catch {
      /* already closed */
    }
  }
}
