import { randomUUID } from "node:crypto";
import type { MemoryNamespace } from "../contracts";
import type { PgPool } from "./postgres-memory-store";

export type MemoryJobKind = "episodic_extraction" | "procedural_learning" | "consolidation";
export type MemoryJobStatus = "pending" | "leased" | "completed" | "failed" | "dead";
export interface DurableMemoryJob { id: string; kind: MemoryJobKind; handlerVersion: number; idempotencyKey: string; tenantId: string; namespace: MemoryNamespace; runId?: string; memoryId?: string; status: MemoryJobStatus; attempts: number; availableAt: string; leasedBy?: string; leaseExpiresAt?: string; lastErrorCode?: string; createdAt: string; updatedAt: string; completedAt?: string }
export interface EnqueueMemoryJob { kind: MemoryJobKind; handlerVersion?: number; idempotencyKey: string; tenantId: string; namespace: MemoryNamespace; runId?: string; memoryId?: string }
const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v);
const decode = (r: any): DurableMemoryJob => ({ id:r.id,kind:r.job_kind,handlerVersion:r.handler_version,idempotencyKey:r.idempotency_key,tenantId:r.tenant_id,namespace:{scope:r.namespace_scope,id:r.namespace_id},runId:r.run_id??undefined,memoryId:r.memory_id??undefined,status:r.status,attempts:r.attempts,availableAt:iso(r.available_at),leasedBy:r.leased_by??undefined,leaseExpiresAt:r.lease_expires_at?iso(r.lease_expires_at):undefined,lastErrorCode:r.last_error_code??undefined,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),completedAt:r.completed_at?iso(r.completed_at):undefined });
/** PostgreSQL is authoritative. Claim uses database time and SKIP LOCKED atomically. */
export class PostgresMemoryJobStore {
  constructor(private readonly pool: PgPool) {}
  async enqueue(input: EnqueueMemoryJob): Promise<{ job: DurableMemoryJob; duplicate: boolean }> {
    const version=input.handlerVersion??1, id=randomUUID();
    const result=await this.pool.query(`INSERT INTO studio_memory_jobs (id,job_kind,handler_version,idempotency_key,tenant_id,namespace_scope,namespace_id,run_id,memory_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (job_kind,handler_version,idempotency_key) DO NOTHING RETURNING *`,[id,input.kind,version,input.idempotencyKey,input.tenantId,input.namespace.scope,input.namespace.id,input.runId??null,input.memoryId??null]);
    if(result.rows.length)return {job:decode(result.rows[0]),duplicate:false};
    const existing=await this.pool.query(`SELECT * FROM studio_memory_jobs WHERE job_kind=$1 AND handler_version=$2 AND idempotency_key=$3`,[input.kind,version,input.idempotencyKey]);
    return {job:decode(existing.rows[0]),duplicate:true};
  }
  async claim(workerId:string,limit=1,leaseMs=30_000):Promise<DurableMemoryJob[]> {
    const c=await this.pool.connect(); try { await c.query("BEGIN"); const r=await c.query(`WITH eligible AS (SELECT id FROM studio_memory_jobs WHERE (status IN ('pending','failed') AND available_at<=now()) OR (status='leased' AND lease_expires_at<=now()) ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE studio_memory_jobs j SET status='leased',attempts=j.attempts+1,leased_by=$2,lease_expires_at=now()+($3::text||' milliseconds')::interval,updated_at=now() FROM eligible WHERE j.id=eligible.id RETURNING j.*`,[Math.max(1,Math.min(100,limit)),workerId,Math.max(1000,leaseMs)]); await c.query("COMMIT"); return r.rows.map(decode); } catch(e){try{await c.query("ROLLBACK");}catch{}throw e;} finally{c.release();}
  }
  async complete(id:string,workerId:string):Promise<boolean>{const r=await this.pool.query(`UPDATE studio_memory_jobs SET status='completed',leased_by=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now() WHERE id=$1 AND status='leased' AND leased_by=$2 AND lease_expires_at>now()`,[id,workerId]);return !!r.rowCount;}
  async fail(id:string,workerId:string,code:string,retryable:boolean,maxAttempts=3):Promise<MemoryJobStatus|null>{const r=await this.pool.query(`UPDATE studio_memory_jobs SET status=CASE WHEN $4 AND attempts<$5 THEN 'failed' ELSE 'dead' END,available_at=CASE WHEN $4 AND attempts<$5 THEN now()+(LEAST(30000,250*(2^attempts))::text||' milliseconds')::interval ELSE available_at END,leased_by=NULL,lease_expires_at=NULL,last_error_code=$3,updated_at=now() WHERE id=$1 AND status='leased' AND leased_by=$2 RETURNING status`,[id,workerId,code,retryable,maxAttempts]);return r.rows[0]?.status??null;}
  async retryDead(id:string):Promise<boolean>{const r=await this.pool.query(`UPDATE studio_memory_jobs SET status='pending',attempts=0,available_at=now(),leased_by=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=now() WHERE id=$1 AND status IN ('dead','failed')`,[id]);return !!r.rowCount;}
  async counts():Promise<Record<string,number>>{const r=await this.pool.query(`SELECT status,count(*)::int count FROM studio_memory_jobs GROUP BY status`);return Object.fromEntries(r.rows.map(x=>[x.status,x.count]));}
}
