CREATE TABLE record_number_settings (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 entity text NOT NULL CHECK (entity IN ('customers','bookings','trips','routes','fleet','team','requests','availability')),
 prefix text NOT NULL DEFAULT '' CHECK (length(prefix)<=16),
 suffix text NOT NULL DEFAULT '' CHECK (length(suffix)<=16),
 digits integer NOT NULL DEFAULT 5 CHECK (digits BETWEEN 1 AND 12),
 next_value bigint NOT NULL DEFAULT 1 CHECK (next_value>0),
 PRIMARY KEY (tenant_id,entity)
);
CREATE TABLE record_numbers (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 entity text NOT NULL,
 record_id uuid NOT NULL,
 sequence bigint NOT NULL,
 number text NOT NULL,
 PRIMARY KEY (tenant_id,entity,record_id),
 UNIQUE (tenant_id,entity,number),
 UNIQUE (tenant_id,entity,sequence)
);
CREATE INDEX record_number_lookup ON record_numbers(tenant_id,lower(number) text_pattern_ops);
CREATE FUNCTION default_record_prefix(entity text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE entity WHEN 'customers' THEN 'CL-' WHEN 'bookings' THEN 'BK-' WHEN 'trips' THEN 'TR-' WHEN 'routes' THEN 'RT-' WHEN 'fleet' THEN 'VH-' WHEN 'team' THEN 'TM-' WHEN 'requests' THEN 'RQ-' WHEN 'availability' THEN 'AV-' END
$$;
CREATE FUNCTION assign_record_number() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE setting record; candidate text; allocated bigint;
BEGIN
 IF TG_OP='DELETE' THEN
   DELETE FROM record_numbers WHERE tenant_id=OLD.tenant_id AND entity=TG_ARGV[0] AND record_id=OLD.id;
   RETURN OLD;
 END IF;
 INSERT INTO record_number_settings(tenant_id,entity,prefix) VALUES(NEW.tenant_id,TG_ARGV[0],default_record_prefix(TG_ARGV[0])) ON CONFLICT DO NOTHING;
 LOOP
   UPDATE record_number_settings SET next_value=next_value+1 WHERE tenant_id=NEW.tenant_id AND entity=TG_ARGV[0]
     RETURNING prefix,suffix,digits,next_value-1 AS value INTO setting;
   allocated := setting.value;
   -- lpad alone truncates values longer than its requested width.
   candidate := setting.prefix || lpad(allocated::text,greatest(setting.digits,length(allocated::text)),'0') || setting.suffix;
   INSERT INTO record_numbers(tenant_id,entity,record_id,sequence,number) VALUES(NEW.tenant_id,TG_ARGV[0],NEW.id,allocated,candidate) ON CONFLICT (tenant_id,entity,number) DO NOTHING;
   EXIT WHEN FOUND;
 END LOOP;
 RETURN NEW;
END $$;
DO $$
DECLARE entry record; record_row record; allocated bigint;
BEGIN
 FOR entry IN SELECT * FROM (VALUES ('customers','customers'),('bookings','bookings'),('trips','trips'),('routes','routes'),('vehicles','fleet'),('memberships','team'),('individual_transfer_requests','requests'),('availability_blocks','availability')) AS x(table_name,entity) LOOP
  -- Deterministic backfill preserves UUID primary keys and every existing relationship.
  FOR record_row IN EXECUTE format('SELECT tenant_id,id FROM %I ORDER BY created_at,id',entry.table_name) LOOP
   INSERT INTO record_number_settings(tenant_id,entity,prefix) VALUES(record_row.tenant_id,entry.entity,default_record_prefix(entry.entity)) ON CONFLICT DO NOTHING;
   UPDATE record_number_settings SET next_value=next_value+1 WHERE tenant_id=record_row.tenant_id AND entity=entry.entity RETURNING next_value-1 INTO allocated;
   INSERT INTO record_numbers VALUES(record_row.tenant_id,entry.entity,record_row.id,allocated,default_record_prefix(entry.entity)||lpad(allocated::text,greatest(5,length(allocated::text)),'0'));
  END LOOP;
  EXECUTE format('CREATE TRIGGER record_number_insert AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION assign_record_number(%L)',entry.table_name,entry.entity);
  EXECUTE format('CREATE TRIGGER record_number_delete AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION assign_record_number(%L)',entry.table_name,entry.entity);
 END LOOP;
END $$;
