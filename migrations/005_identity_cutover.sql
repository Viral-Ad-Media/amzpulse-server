-- Keep application IDs and memberships. Auth owns credentials and sessions.
UPDATE "User" SET name = email WHERE name IS NULL OR name = '';
ALTER TABLE "User" ALTER COLUMN name SET NOT NULL;
CREATE UNIQUE INDEX "AuthAccount_provider_account_key" ON "AuthAccount" ("providerId", "accountId");
ALTER TABLE "AuthSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthVerification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AuthSession", "AuthAccount", "AuthVerification" FROM PUBLIC;

CREATE FUNCTION provision_workspace() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE oid text;
BEGIN
 IF current_setting('amzpulse.import', true) = 'on' THEN RETURN NEW; END IF;
 INSERT INTO "Organization"(name) VALUES(coalesce(nullif(NEW.name,''), NEW.email)||'''s Workspace') RETURNING id INTO oid;
 INSERT INTO "Membership"("userId","organizationId",role) VALUES(NEW.id,oid,'owner');
 RETURN NEW;
END $$;
CREATE TRIGGER provision_user_workspace AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION provision_workspace();

-- The compatibility function also uses the trigger so there is one atomic workspace per signup.
CREATE OR REPLACE FUNCTION register_account(p_email text,p_name text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE u "User"; o "Organization";
BEGIN
 INSERT INTO "User"(email,name,"passwordHash") VALUES(p_email,coalesce(nullif(p_name,''),p_email),p_hash) RETURNING * INTO u;
 SELECT org.* INTO STRICT o FROM "Organization" org JOIN "Membership" m ON m."organizationId"=org.id WHERE m."userId"=u.id;
 RETURN jsonb_build_object('user',to_jsonb(u)-'passwordHash','organization',to_jsonb(o));
END $$;

-- Valid legacy credentials retain their user IDs. Unsupported hashes require password recovery.
INSERT INTO "AuthAccount"(id,"accountId","providerId","userId",password,"createdAt","updatedAt")
 SELECT gen_random_uuid()::text,id,'credential',id,"passwordHash","createdAt",now() FROM "User"
 WHERE "passwordHash" ~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$'
 ON CONFLICT ("providerId","accountId") DO NOTHING;

-- Password changes and resets invalidate sessions/API keys in the same database transaction.
CREATE FUNCTION credential_changed() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 IF NEW."providerId"='credential' AND NEW.password IS DISTINCT FROM OLD.password THEN
  UPDATE "User" SET "passwordHash"=NULL,"tokenVersion"="tokenVersion"+1 WHERE id=NEW."userId";
  UPDATE "ApiKey" SET revoked=true WHERE "userId"=NEW."userId";
  DELETE FROM "AuthSession" WHERE "userId"=NEW."userId";
  DELETE FROM "PasswordResetToken" WHERE "userId"=NEW."userId";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credential_changed AFTER UPDATE OF password ON "AuthAccount" FOR EACH ROW EXECUTE FUNCTION credential_changed();
REVOKE ALL ON FUNCTION provision_workspace(), credential_changed() FROM PUBLIC;
