-- Server-owned data: never expose it through publishable/anonymous credentials.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['User','Organization','Membership','ApiKey','OrganizationUsage','PasswordResetToken','Product','ProductMetric','WatchlistItem','SourcingNote'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
 END LOOP;
END $$;
ALTER TABLE public."User" ADD COLUMN "tokenVersion" integer NOT NULL DEFAULT 0;
ALTER TABLE public."Organization" ADD COLUMN "stripeEventCreated" bigint NOT NULL DEFAULT 0;
ALTER TABLE public."Organization" ADD COLUMN "stripeEventId" text;
ALTER TABLE public."OrganizationUsage" ADD COLUMN "aiCalls" integer NOT NULL DEFAULT 0;
ALTER TABLE public."Product" ADD COLUMN "canonicalData" jsonb;
ALTER TABLE public."Product" ADD COLUMN "syncAttemptedAt" timestamptz;
CREATE INDEX "Product_syncAttemptedAt_asin_idx" ON public."Product" ("syncAttemptedAt" ASC NULLS FIRST, asin);
CREATE TABLE public."UsageReservation" (
 id uuid PRIMARY KEY, "organizationId" text NOT NULL REFERENCES public."Organization"(id),
 month text NOT NULL, kind text NOT NULL CHECK (kind IN ('asin','ai')), units integer NOT NULL CHECK (units > 0),
 "isBatch" boolean NOT NULL DEFAULT false, "settledAt" timestamptz, "expiresAt" timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);
CREATE INDEX "UsageReservation_pending_idx" ON public."UsageReservation" ("organizationId", "expiresAt") WHERE "settledAt" IS NULL;
ALTER TABLE public."UsageReservation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."UsageReservation" FROM anon, authenticated;
GRANT ALL ON public."UsageReservation" TO service_role;

CREATE FUNCTION public.register_account(p_email text,p_name text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE u public."User"; o public."Organization";
BEGIN
 INSERT INTO "Organization"(name) VALUES(coalesce(nullif(p_name,''),p_email)||'''s Workspace') RETURNING * INTO o;
 INSERT INTO "User"(email,name,"passwordHash") VALUES(p_email,p_name,p_hash) RETURNING * INTO u;
 INSERT INTO "Membership"("userId","organizationId",role) VALUES(u.id,o.id,'owner');
 RETURN jsonb_build_object('user',to_jsonb(u)-'passwordHash','organization',to_jsonb(o));
END $$;

CREATE FUNCTION public.reset_account_password(p_token_hash text,p_password_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE uid text;
BEGIN
 UPDATE "PasswordResetToken" SET "usedAt"=now() WHERE "tokenHash"=p_token_hash AND "usedAt" IS NULL AND "expiresAt">now() RETURNING "userId" INTO uid;
 IF uid IS NULL THEN RETURN false; END IF;
 UPDATE "User" SET "passwordHash"=p_password_hash,"tokenVersion"="tokenVersion"+1 WHERE id=uid;
 UPDATE "ApiKey" SET revoked=true WHERE "userId"=uid;
 DELETE FROM "PasswordResetToken" WHERE "userId"=uid;
 RETURN true;
END $$;

CREATE FUNCTION public.reserve_usage(p_org text,p_units integer,p_kind text,p_id uuid,p_batch boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE o public."Organization"; m text := to_char(now() AT TIME ZONE 'UTC','YYYY-MM');
 quota integer; max_batch integer; r record; counter integer;
BEGIN
 IF p_units<1 OR p_kind NOT IN ('asin','ai') THEN RAISE EXCEPTION 'Invalid usage request'; END IF;
 SELECT * INTO STRICT o FROM "Organization" WHERE id=p_org FOR UPDATE;
 IF o.plan='pro' AND o."planRenewsAt">now() THEN quota:=CASE WHEN p_kind='ai' THEN 1000 ELSE 5000 END; max_batch:=100;
 ELSE quota:=CASE WHEN p_kind='ai' THEN 50 ELSE 300 END; max_batch:=20; END IF;
 IF p_units>max_batch THEN RAISE EXCEPTION 'Batch size exceeds plan limit (%)',max_batch; END IF;
 -- Recover reservations abandoned by crashed/disconnected workers.
 FOR r IN SELECT * FROM "UsageReservation" WHERE "organizationId"=p_org AND "settledAt" IS NULL AND "expiresAt"<now() FOR UPDATE LOOP
  UPDATE "OrganizationUsage" SET "asinsAnalyzed"="asinsAnalyzed"-CASE WHEN r.kind='asin' THEN r.units ELSE 0 END,"aiCalls"="aiCalls"-CASE WHEN r.kind='ai' THEN r.units ELSE 0 END WHERE "organizationId"=p_org AND month=r.month;
  UPDATE "UsageReservation" SET "settledAt"=now() WHERE id=r.id;
 END LOOP;
 INSERT INTO "OrganizationUsage"("organizationId",month) VALUES(p_org,m) ON CONFLICT("organizationId",month) DO NOTHING;
 SELECT CASE WHEN p_kind='ai' THEN "aiCalls" ELSE "asinsAnalyzed" END INTO counter FROM "OrganizationUsage" WHERE "organizationId"=p_org AND month=m;
 IF counter+p_units>quota THEN RAISE EXCEPTION 'Monthly quota exceeded'; END IF;
 INSERT INTO "UsageReservation"(id,"organizationId",month,kind,units,"isBatch") VALUES(p_id,p_org,m,p_kind,p_units,p_batch);
 UPDATE "OrganizationUsage" SET "asinsAnalyzed"="asinsAnalyzed"+CASE WHEN p_kind='asin' THEN p_units ELSE 0 END,"aiCalls"="aiCalls"+CASE WHEN p_kind='ai' THEN p_units ELSE 0 END,"updatedAt"=now() WHERE "organizationId"=p_org AND month=m;
 RETURN p_id;
END $$;

CREATE FUNCTION public.settle_usage(p_id uuid,p_success integer) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r public."UsageReservation"; oid text;
BEGIN
 SELECT "organizationId" INTO oid FROM "UsageReservation" WHERE id=p_id;
 PERFORM 1 FROM "Organization" WHERE id=oid FOR UPDATE;
 SELECT * INTO r FROM "UsageReservation" WHERE id=p_id AND "settledAt" IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_success<0 OR p_success>r.units THEN RAISE EXCEPTION 'Invalid settlement'; END IF;
 UPDATE "OrganizationUsage" SET "asinsAnalyzed"="asinsAnalyzed"-CASE WHEN r.kind='asin' THEN r.units-p_success ELSE 0 END,"aiCalls"="aiCalls"-CASE WHEN r.kind='ai' THEN r.units-p_success ELSE 0 END,"batchRuns"="batchRuns"+CASE WHEN r.kind='asin' AND r."isBatch" AND p_success>0 THEN 1 ELSE 0 END,"updatedAt"=now() WHERE "organizationId"=r."organizationId" AND month=r.month;
 UPDATE "UsageReservation" SET "settledAt"=now() WHERE id=p_id;
 RETURN true;
END $$;

CREATE FUNCTION public.apply_subscription(p_org text,p_customer text,p_subscription text,p_plan text,p_end timestamptz,p_event_created bigint,p_event_id text,p_is_deleted boolean) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE o public."Organization";
BEGIN
 SELECT * INTO STRICT o FROM "Organization" WHERE id=p_org FOR UPDATE;
 IF o."stripeCustomerId" IS DISTINCT FROM p_customer THEN RAISE EXCEPTION 'Customer mismatch'; END IF;
 IF o."stripeEventId"=p_event_id OR o."stripeEventCreated">p_event_created THEN RETURN false; END IF;
 IF p_is_deleted AND o."stripeSubscriptionId" IS DISTINCT FROM p_subscription THEN RETURN false; END IF;
 UPDATE "Organization" SET plan=p_plan,"stripeSubscriptionId"=p_subscription,"planRenewsAt"=p_end,"stripeEventCreated"=p_event_created,"stripeEventId"=p_event_id WHERE id=p_org;
 RETURN true;
END $$;
-- These functions use invoker rights, service_role only. No client-side JWT is trusted.
REVOKE ALL ON FUNCTION public.register_account(text,text,text), public.reset_account_password(text,text), public.reserve_usage(text,integer,text,uuid,boolean), public.settle_usage(uuid,integer), public.apply_subscription(text,text,text,text,timestamptz,bigint,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_account(text,text,text), public.reset_account_password(text,text), public.reserve_usage(text,integer,text,uuid,boolean), public.settle_usage(uuid,integer), public.apply_subscription(text,text,text,text,timestamptz,bigint,text,boolean) TO service_role;
