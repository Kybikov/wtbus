DO $$ DECLARE entity text; BEGIN
  FOREACH entity IN ARRAY ARRAY['trips','bookings','payments','individual_transfer_requests','routes','vehicles','drivers','memberships','customers','availability_blocks','gps_points','activity_events','tenant_branding','tenant_payment_configs','custom_field_definitions','entity_views'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS crm_event ON %I',entity);
  END LOOP;
END $$;
DROP FUNCTION capture_crm_event();
DROP TABLE push_jobs,app_notifications,realtime_events,push_subscriptions,notification_preferences,push_configuration;
